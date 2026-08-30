import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import {
  ComfyUIClient,
  ComfyUIImageProvider,
  ComfyUIVideoProvider,
  FilmGameComfyWorkflowRegistry,
} from '@filmgame/comfyui-adapter';
import { CosyVoiceTTSProvider, LocalTemporaryAssetStager } from '@filmgame/cosyvoice-adapter';
import { CodexCliLLMProvider } from '@filmgame/codex-cli-adapter';
import { MediaPipeline } from '@filmgame/media-pipeline';
import { runDeterministicBotPlaytest } from '@filmgame/playtest-engine';
import { OpenAICompatibleLLMProvider } from '@filmgame/openai-compatible-adapter';
import {
  defineCapabilities,
  FallbackVideoProvider,
  type LLMProvider,
  type ProviderHealth,
  type StorageProvider,
  type VideoProvider,
} from '@filmgame/provider-sdk';
import { RemoteVideoProvider } from '@filmgame/remote-video-adapter';
import { RemoteMusicProvider, RemoteSfxProvider } from '@filmgame/remote-audio-adapter';
import { RemoteStorageProvider } from '@filmgame/remote-storage-adapter';
import type { StoryModel } from '@filmgame/shared-types';
import { proposeChange, validateStory } from '@filmgame/story-engine';
import { LocalStorageProvider } from '@filmgame/storage-service';
import { JobGraph } from '@filmgame/job-engine';
import { previewProductionInvalidation } from '@filmgame/dependency-graph';

import {
  StoryGenerationWorkflow,
  type StoryGenerationResult,
} from './story-workflow.js';
import {
  ProductionPlanningWorkflow,
  type ProductionPlanningResult,
} from './production-workflow.js';
import {
  createFinalizationHandlers,
  createAudioAssetHandlers,
  createMediaAssetHandlers,
  createVoiceAssetHandlers,
  JsonLinesProductionAuditSink,
  ProductionOrchestrator,
  FileProductionRunStore,
  createProductionPlan,
  estimateJobCost,
  estimateProductionCost,
  type ProductionCostEstimate,
  type ProductionCostRates,
  toCreatorFailure,
  type CreatorFailure,
} from './index.js';

type GenerationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
type ExecutionStatus = GenerationStatus | 'PAUSED_BUDGET' | 'CANCELLED';

interface GenerationJob {
  id: string;
  projectId: string;
  status: GenerationStatus;
  createdAt: string;
  updatedAt: string;
  result?: StoryGenerationResult;
  error?: string;
}

interface ProductionPlanningJob {
  id: string;
  projectId: string;
  productionVersion: number;
  status: GenerationStatus;
  createdAt: string;
  updatedAt: string;
  story: StoryModel;
  result?: ProductionPlanningResult;
  error?: string;
  executionStatus?: ExecutionStatus;
  executionSummary?: {
    completed: number;
    failed: number;
    blocked: number;
    cancelled: number;
    paused: number;
    total: number;
  };
  executionError?: string;
  executionFailure?: CreatorFailure;
  costEstimate?: ProductionCostEstimate;
  maxBudget?: { currency: string; amount: number };
}

const port = parsePort(process.env.ORCHESTRATOR_PORT ?? '4100');
const provider = createProvider();
const workflow = provider ? new StoryGenerationWorkflow(provider) : null;
const productionWorkflow = provider ? new ProductionPlanningWorkflow(provider) : null;
const jobs = new Map<string, GenerationJob>();
const productionJobs = new Map<string, ProductionPlanningJob>();
const productionRunStore = new FileProductionRunStore(
  path.resolve(
    process.env.PRODUCTION_JOB_STATE_ROOT ?? path.join(process.cwd(), '.local', 'production-runs'),
  ),
);
const recoveredProductionRunIds = await recoverPersistedProductionJobs();
const productionCostRates = costRatesFromEnvironment();

const server = createServer(async (request, response) => {
  try {
    applyCors(response);
    if (request.method === 'OPTIONS') return send(response, 204, null);
    if (!authorize(request)) return send(response, 401, { error: 'UNAUTHORIZED' });
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      const health: ProviderHealth = provider
        ? await provider.health()
        : {
            status: 'UNCONFIGURED',
            checkedAt: new Date().toISOString(),
            message: 'Configure an API LLMProvider or the development-only Codex CLI provider',
          };
      return send(response, 200, {
        status: health.status === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED',
        llm: health,
        production: productionReadiness(),
      });
    }

    if (request.method === 'POST' && url.pathname === '/v1/story/generations') {
      if (!workflow) {
        return send(response, 503, {
          error: 'LLM_PROVIDER_UNCONFIGURED',
          message: 'Configure an API LLMProvider or enable the development Codex CLI provider.',
        });
      }
      const body = await readJson(request);
      const projectId = stringField(body, 'projectId', 2, 96);
      const idea = stringField(body, 'idea', 40, 12_000);
      const job = createJob(projectId);
      jobs.set(job.id, job);
      void runGeneration(job, idea);
      return send(response, 202, { job: publicJob(job) });
    }

    if (request.method === 'POST' && url.pathname === '/v1/production/plans') {
      if (!productionWorkflow) {
        return send(response, 503, {
          error: 'LLM_PROVIDER_UNCONFIGURED',
          message: 'Configure an API LLMProvider or enable the development Codex CLI provider.',
        });
      }
      const body = await readJson(request);
      const story = storyField(body);
      const validation = validateStory(story);
      if (!validation.valid) {
        return send(response, 422, { error: 'STORY_INVALID', validation });
      }
      const productionVersion = integerField(body, 'productionVersion', 1, 1_000_000);
      const budget = optionalBudget(body);
      const job = createProductionJob(story, productionVersion, budget);
      productionJobs.set(job.id, job);
      void runProductionPlanning(job, story);
      return send(response, 202, { job: publicProductionJob(job) });
    }

    if (request.method === 'POST' && url.pathname === '/v1/story/changes/proposals') {
      const body = await readJson(request);
      const story = storyField(body);
      const projectId = stringField(body, 'projectId', 2, 96);
      const baseStoryVersion = integerField(body, 'baseStoryVersion', 1, 1_000_000);
      const text = stringField(body, 'text', 2, 12_000);
      const proposal = await proposeChange(story, {
        commandId: `command-${crypto.randomUUID()}`,
        projectId,
        baseStoryVersion,
        text,
      });
      return send(response, 200, { proposal });
    }

    if (request.method === 'POST' && url.pathname === '/v1/playtests/bot') {
      const body = await readJson(request);
      const story = storyField(body);
      const validation = validateStory(story);
      if (!validation.valid) {
        return send(response, 422, { error: 'STORY_INVALID', validation });
      }
      const report = runDeterministicBotPlaytest(story, {
        maxTransitions:
          body.maxTransitions === undefined
            ? 256
            : integerField(body, 'maxTransitions', 1, 10_000),
      });
      return send(response, 200, { report });
    }

    const jobMatch = url.pathname.match(/^\/v1\/story\/generations\/([^/]+)$/u);
    if (request.method === 'GET' && jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]!));
      return job
        ? send(response, 200, { job: publicJob(job) })
        : send(response, 404, { error: 'JOB_NOT_FOUND' });
    }


    const productionMatch = url.pathname.match(/^\/v1\/production\/plans\/([^/]+)$/u);
    if (request.method === 'GET' && productionMatch) {
      const job = productionJobs.get(decodeURIComponent(productionMatch[1]!));
      return job
        ? send(response, 200, { job: publicProductionJob(job) })
        : send(response, 404, { error: 'PRODUCTION_PLAN_NOT_FOUND' });
    }

    const productionRunMatch = url.pathname.match(
      /^\/v1\/production\/plans\/([^/]+)\/run$/u,
    );
    const invalidationPreviewMatch = url.pathname.match(
      /^\/v1\/production\/plans\/([^/]+)\/invalidation-preview$/u,
    );
    if (request.method === 'POST' && invalidationPreviewMatch) {
      const job = productionJobs.get(decodeURIComponent(invalidationPreviewMatch[1]!));
      if (!job?.result) return send(response, 404, { error: 'PRODUCTION_PLAN_NOT_FOUND' });
      const body = await readJson(request);
      const value = body.changedEntityIds;
      if (!Array.isArray(value) || !value.length || !value.every((entry) => typeof entry === 'string')) {
        return send(response, 400, { error: 'changedEntityIds must be a non-empty string array' });
      }
      const preview = previewProductionInvalidation(job.result.plan.graph.list(), value);
      return send(response, 200, { preview });
    }
    if (request.method === 'POST' && productionRunMatch) {
      const job = productionJobs.get(decodeURIComponent(productionRunMatch[1]!));
      if (!job) return send(response, 404, { error: 'PRODUCTION_PLAN_NOT_FOUND' });
      if (job.status !== 'SUCCEEDED' || !job.result) {
        return send(response, 409, {
          error: 'PRODUCTION_PLAN_NOT_READY',
          status: job.status,
        });
      }
      if (job.executionStatus === 'RUNNING' || job.executionStatus === 'QUEUED') {
        return send(response, 409, { error: 'PRODUCTION_ALREADY_RUNNING' });
      }
      if (
        job.maxBudget &&
        job.costEstimate &&
        (job.maxBudget.currency !== job.costEstimate.currency ||
          job.costEstimate.maximumAmount > job.maxBudget.amount)
      ) {
        return send(response, 409, {
          error: 'BUDGET_LIMIT_EXCEEDED',
          budget: job.maxBudget,
          estimate: job.costEstimate,
        });
      }
      const blockers = productionExecutionBlockers(job.story);
      if (blockers.length) {
        return send(response, 409, { error: 'PRODUCTION_NOT_ADMITTED', blockers });
      }
      job.executionStatus = 'QUEUED';
      job.updatedAt = new Date().toISOString();
      void runProductionExecution(job);
      return send(response, 202, { job: publicProductionJob(job) });
    }

    return send(response, 404, { error: 'NOT_FOUND' });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Internal orchestrator error';
    return send(response, 400, { error: 'BAD_REQUEST', message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`FilmGame orchestrator listening on http://127.0.0.1:${port}`);
  for (const runId of recoveredProductionRunIds) {
    const recovered = productionJobs.get(runId);
    if (recovered) void runProductionExecution(recovered);
  }
});

function createProvider(): LLMProvider | null {
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (baseUrl && model) {
    return new OpenAICompatibleLLMProvider({
      id: process.env.LLM_PROVIDER_ID ?? 'openai-compatible',
      baseUrl,
      model,
      ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
      structuredMode:
        process.env.LLM_STRUCTURED_MODE === 'JSON_OBJECT' ? 'JSON_OBJECT' : 'JSON_SCHEMA',
      maxOutputTokensField:
        process.env.LLM_MAX_OUTPUT_TOKENS_FIELD === 'max_tokens'
          ? 'max_tokens'
          : 'max_completion_tokens',
    });
  }
  if (
    process.env.CODEX_CLI_LLM_ENABLED === 'true' &&
    process.env.CODEX_CLI_SCRIPT &&
    process.env.CODEX_CLI_MODEL
  ) {
    return new CodexCliLLMProvider({
      nodeExecutable: process.execPath,
      cliScript: path.resolve(process.env.CODEX_CLI_SCRIPT),
      model: process.env.CODEX_CLI_MODEL,
    });
  }
  return null;
}

function productionReadiness(): Record<string, unknown> {
  const localVideoEnabled = process.env.COMFYUI_LOCAL_VIDEO_ENABLED === 'true';
  const remoteVideoEnabled = Boolean(
    process.env.REMOTE_VIDEO_BASE_URL && process.env.REMOTE_VIDEO_MODEL,
  );
  return {
    image: {
      status: process.env.COMFYUI_BASE_URL ? 'CONFIGURED' : 'UNCONFIGURED',
      provider: 'comfyui-image',
    },
    video: {
      status: remoteVideoEnabled || localVideoEnabled ? 'CONFIGURED' : 'BLOCKED',
      provider: remoteVideoEnabled ? 'remote-video' : localVideoEnabled ? 'comfyui-video' : null,
      reason: remoteVideoEnabled || localVideoEnabled
        ? null
        : 'Local video is not capacity-admitted; configure an eligible VideoProvider.',
    },
    tts: {
      status: process.env.COSYVOICE_BASE_URL ? 'CONFIGURED' : 'UNCONFIGURED',
      provider: 'cosyvoice',
    },
    musicAndSfx: {
      status:
        process.env.REMOTE_AUDIO_BASE_URL &&
        process.env.REMOTE_MUSIC_MODEL &&
        process.env.REMOTE_SFX_MODEL
          ? 'CONFIGURED'
          : 'UNCONFIGURED',
      provider: 'remote-audio',
    },
    media: {
      status: process.env.FFMPEG_PATH && process.env.FFPROBE_PATH ? 'CONFIGURED' : 'UNCONFIGURED',
      provider: 'ffmpeg-media-pipeline',
    },
    storage: {
      status:
        process.env.REMOTE_STORAGE_BASE_URL || process.env.ASSET_STORAGE_ROOT
          ? 'CONFIGURED'
          : 'UNCONFIGURED',
      provider: process.env.REMOTE_STORAGE_BASE_URL ? 'remote-storage' : 'local-storage',
    },
  };
}

async function runGeneration(job: GenerationJob, idea: string): Promise<void> {
  if (!workflow) return;
  job.status = 'RUNNING';
  job.updatedAt = new Date().toISOString();
  try {
    job.result = await workflow.generate({
      projectId: job.projectId,
      idea,
      context: { requestId: job.id },
    });
    job.status = 'SUCCEEDED';
  } catch (cause) {
    job.status = 'FAILED';
    job.error = cause instanceof Error ? cause.message : 'Story generation failed';
  }
  job.updatedAt = new Date().toISOString();
}

function createJob(projectId: string): GenerationJob {
  const now = new Date().toISOString();
  return {
    id: `story-generation-${crypto.randomUUID()}`,
    projectId,
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
  };
}

function createProductionJob(
  story: StoryModel,
  productionVersion: number,
  maxBudget?: { currency: string; amount: number },
): ProductionPlanningJob {
  const now = new Date().toISOString();
  return {
    id: `production-plan-${crypto.randomUUID()}`,
    projectId: story.projectId,
    productionVersion,
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
    story: structuredClone(story),
    ...(maxBudget ? { maxBudget } : {}),
  };
}

function publicJob(job: GenerationJob): GenerationJob {
  return structuredClone(job);
}

function publicProductionJob(job: ProductionPlanningJob): Record<string, unknown> {
  return {
    id: job.id,
    projectId: job.projectId,
    productionVersion: job.productionVersion,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.executionStatus ? { executionStatus: job.executionStatus } : {}),
    ...(job.executionSummary ? { executionSummary: job.executionSummary } : {}),
    ...(job.executionError ? { executionError: job.executionError } : {}),
    ...(job.executionFailure ? { executionFailure: job.executionFailure } : {}),
    ...(job.costEstimate ? { costEstimate: job.costEstimate } : {}),
    ...(job.maxBudget ? { maxBudget: job.maxBudget } : {}),
    ...(job.result
      ? {
          result: {
            breakdowns: job.result.breakdowns,
            trace: job.result.trace,
            summary: job.result.plan.summary,
            jobs: job.result.plan.graph.list(),
            transitions: job.result.plan.graph.transitions(),
            progress: job.result.plan.graph.progress(),
          },
        }
      : {}),
  };
}

async function runProductionPlanning(job: ProductionPlanningJob, story: StoryModel): Promise<void> {
  if (!productionWorkflow) return;
  job.status = 'RUNNING';
  job.updatedAt = new Date().toISOString();
  try {
    job.result = await productionWorkflow.plan({
      story,
      productionVersion: job.productionVersion,
      context: { requestId: job.id },
    });
    job.costEstimate = estimateProductionCost(job.result.plan, productionCostRates);
    job.status = 'SUCCEEDED';
  } catch (cause) {
    job.status = 'FAILED';
    job.error = cause instanceof Error ? cause.message : 'Production planning failed';
  }
  job.updatedAt = new Date().toISOString();
}

function productionExecutionBlockers(story: StoryModel): string[] {
  const blockers: string[] = [];
  if (!process.env.COMFYUI_BASE_URL) blockers.push('COMFYUI_BASE_URL is not configured');
  if (
    !(process.env.REMOTE_VIDEO_BASE_URL && process.env.REMOTE_VIDEO_MODEL) &&
    process.env.COMFYUI_LOCAL_VIDEO_ENABLED !== 'true'
  ) {
    blockers.push('No capacity-admitted VideoProvider is configured');
  }
  if (!process.env.COSYVOICE_BASE_URL) blockers.push('COSYVOICE_BASE_URL is not configured');
  if (
    !process.env.REMOTE_AUDIO_BASE_URL ||
    !process.env.REMOTE_MUSIC_MODEL ||
    !process.env.REMOTE_SFX_MODEL
  ) {
    blockers.push('Remote MusicProvider and SFXProvider are not configured');
  }
  if (!process.env.FFMPEG_PATH || !process.env.FFPROBE_PATH) {
    blockers.push('FFMPEG_PATH and FFPROBE_PATH are required');
  }
  if (!process.env.REMOTE_STORAGE_BASE_URL && !process.env.ASSET_STORAGE_ROOT) {
    blockers.push('No StorageProvider is configured');
  }
  if (!process.env.MEDIA_WORK_ROOT) blockers.push('MEDIA_WORK_ROOT is not configured');
  const unvoiced = story.characters
    .filter(
      (character) =>
        !character.voice.voiceId && !character.voice.voiceReferenceAssetId,
    )
    .map((character) => character.id);
  if (unvoiced.length) {
    blockers.push(`Characters have no approved voice binding: ${unvoiced.join(', ')}`);
  }
  return blockers;
}

async function runProductionExecution(job: ProductionPlanningJob): Promise<void> {
  if (!job.result) return;
  job.executionStatus = 'RUNNING';
  job.updatedAt = new Date().toISOString();
  try {
    const mediaWorkRoot = path.resolve(requiredEnvironment('MEDIA_WORK_ROOT'));
    const storageRoot = process.env.ASSET_STORAGE_ROOT
      ? path.resolve(process.env.ASSET_STORAGE_ROOT)
      : null;
    const storage: StorageProvider = process.env.REMOTE_STORAGE_BASE_URL
      ? new RemoteStorageProvider({
          baseUrl: process.env.REMOTE_STORAGE_BASE_URL,
          ...(process.env.REMOTE_STORAGE_API_TOKEN
            ? { token: process.env.REMOTE_STORAGE_API_TOKEN }
            : {}),
        })
      : new LocalStorageProvider({ rootDirectory: storageRoot! });
    const comfyClient = new ComfyUIClient(
      {
        baseUrl: requiredEnvironment('COMFYUI_BASE_URL'),
        clientId: `orchestrator-${job.id}`,
        minimumFreeRamBytes: parsePositiveInteger(
          process.env.COMFYUI_MINIMUM_FREE_RAM_BYTES ?? String(2 * 1024 ** 3),
          'COMFYUI_MINIMUM_FREE_RAM_BYTES',
        ),
      },
      new FilmGameComfyWorkflowRegistry(),
    );
    const image = new ComfyUIImageProvider(comfyClient);
    const remoteVideo: VideoProvider | null =
      process.env.REMOTE_VIDEO_BASE_URL && process.env.REMOTE_VIDEO_MODEL
        ? new RemoteVideoProvider({
            baseUrl: process.env.REMOTE_VIDEO_BASE_URL,
            model: process.env.REMOTE_VIDEO_MODEL,
            ...(process.env.REMOTE_VIDEO_API_TOKEN
              ? { token: process.env.REMOTE_VIDEO_API_TOKEN }
              : {}),
          })
        : null;
    const localVideo: VideoProvider | null =
      process.env.COMFYUI_LOCAL_VIDEO_ENABLED === 'true'
        ? new ComfyUIVideoProvider(comfyClient)
        : null;
    const videoCandidates = [
      ...(remoteVideo
        ? [
            {
              provider: remoteVideo,
              capabilities: defineCapabilities({
                supportsTextToVideo: true,
                supportsImageToVideo: true,
                supportsReferenceImage: true,
                supportsSeed: true,
                supportsNegativePrompt: true,
                supportsResolution: true,
                supportsDuration: true,
                supportsAsyncJob: true,
                supportsCancellation: true,
                supportsCostEstimate: true,
              }),
              priority: 100,
            },
          ]
        : []),
      ...(localVideo
        ? [
            {
              provider: localVideo,
              capabilities: defineCapabilities({
                supportsImageToVideo: true,
                supportsReferenceImage: true,
                supportsSeed: true,
                supportsNegativePrompt: true,
                supportsResolution: true,
                supportsDuration: true,
                supportsCancellation: true,
              }),
              priority: 10,
            },
          ]
        : []),
    ];
    const video: VideoProvider = new FallbackVideoProvider(
      videoCandidates,
      ['supportsImageToVideo', 'supportsReferenceImage', 'supportsDuration'],
      {
        attemptsPerProvider: parsePositiveInteger(
          process.env.VIDEO_PROVIDER_ATTEMPTS ?? '2',
          'VIDEO_PROVIDER_ATTEMPTS',
        ),
        timeoutMs: parsePositiveInteger(
          process.env.VIDEO_PROVIDER_TIMEOUT_MS ?? String(30 * 60_000),
          'VIDEO_PROVIDER_TIMEOUT_MS',
        ),
        circuitFailureThreshold: parsePositiveInteger(
          process.env.VIDEO_PROVIDER_CIRCUIT_FAILURES ?? '3',
          'VIDEO_PROVIDER_CIRCUIT_FAILURES',
        ),
        circuitCooldownMs: parsePositiveInteger(
          process.env.VIDEO_PROVIDER_CIRCUIT_COOLDOWN_MS ?? '60000',
          'VIDEO_PROVIDER_CIRCUIT_COOLDOWN_MS',
        ),
      },
    );
    const tts = new CosyVoiceTTSProvider({
      baseUrl: requiredEnvironment('COSYVOICE_BASE_URL'),
      sampleRateHz: 24_000,
      stager: new LocalTemporaryAssetStager(
        path.resolve(
          process.env.TTS_STAGING_ROOT ??
            path.join(storageRoot ? path.dirname(storageRoot) : mediaWorkRoot, 'staging', 'tts'),
        ),
      ),
    });
    const remoteAudioConfig = {
      baseUrl: requiredEnvironment('REMOTE_AUDIO_BASE_URL'),
      musicModel: requiredEnvironment('REMOTE_MUSIC_MODEL'),
      sfxModel: requiredEnvironment('REMOTE_SFX_MODEL'),
      ...(process.env.REMOTE_AUDIO_API_TOKEN
        ? { token: process.env.REMOTE_AUDIO_API_TOKEN }
        : {}),
    };
    const music = new RemoteMusicProvider(remoteAudioConfig);
    const sfx = new RemoteSfxProvider(remoteAudioConfig);
    const media = new MediaPipeline({
      ffmpegPath: requiredEnvironment('FFMPEG_PATH'),
      ffprobePath: requiredEnvironment('FFPROBE_PATH'),
      defaultVideoCodec: 'libopenh264',
      defaultAudioCodec: 'aac',
    });
    const health = await Promise.all([
      image.health(),
      video.health(),
      tts.health(),
      music.health(),
      sfx.health(),
      storage.health(),
      media.health(),
    ]);
    const unavailable = health.filter((entry) => entry.status !== 'HEALTHY');
    if (unavailable.length) {
      throw new Error(`Production providers are unavailable: ${JSON.stringify(unavailable)}`);
    }
    const plan = job.result.plan;
    const handlers = {
      ...createMediaAssetHandlers(plan, {
        image,
        video,
        storage,
        referenceUriByAssetId: referenceAssetUriMap(),
      }),
      ...createVoiceAssetHandlers(plan, job.story, { tts, storage }),
      ...createAudioAssetHandlers(plan, { music, sfx, storage }),
      ...createFinalizationHandlers(plan, {
        media,
        storage,
        workDirectory: mediaWorkRoot,
        story: job.story,
        productionAssetsCommerciallyApproved:
          process.env.PRODUCTION_ASSETS_COMMERCIAL_APPROVED === 'true',
        autoApproveQaAssets: process.env.AUTO_APPROVE_QA_ASSETS === 'true',
      }),
    };
    const auditPath = path.resolve(
      process.env.PRODUCTION_AUDIT_LOG ?? path.join(mediaWorkRoot, '..', 'audit', 'production.jsonl'),
    );
    const orchestrator = new ProductionOrchestrator(plan, handlers, {
      auditSink: new JsonLinesProductionAuditSink(auditPath),
      runStore: productionRunStore,
      runId: job.id,
      snapshotContext: { story: job.story, breakdowns: job.result.breakdowns },
      ...(job.maxBudget
        ? {
            budget: { currency: job.maxBudget.currency, maxAmount: job.maxBudget.amount },
            estimateCost: (candidate) => estimateJobCost(candidate, productionCostRates),
          }
        : {}),
    });
    job.executionSummary = await orchestrator.runUntilSettled(2);
    if (job.executionSummary.failed || job.executionSummary.blocked) {
      job.executionStatus = 'FAILED';
      job.executionError = 'One or more production jobs failed or were blocked';
    } else {
      job.executionStatus = 'SUCCEEDED';
    }
  } catch (cause) {
    job.executionStatus = 'FAILED';
    job.executionError = cause instanceof Error ? cause.message : 'Production execution failed';
    job.executionFailure = toCreatorFailure(cause, `Production run ${job.id}`);
  }
  job.updatedAt = new Date().toISOString();
}

async function recoverPersistedProductionJobs(): Promise<string[]> {
  const resumed: string[] = [];
  for (const snapshot of await productionRunStore.list()) {
    if (!['QUEUED', 'RUNNING'].includes(snapshot.executionStatus)) continue;
    const plan = createProductionPlan(
      snapshot.story,
      snapshot.productionVersion,
      snapshot.breakdowns,
    );
    plan.graph = new JobGraph(snapshot.jobs, { recoverRunning: true });
    const job: ProductionPlanningJob = {
      id: snapshot.runId,
      projectId: snapshot.projectId,
      productionVersion: snapshot.productionVersion,
      status: 'SUCCEEDED',
      createdAt: snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      story: structuredClone(snapshot.story),
      result: {
        breakdowns: structuredClone(snapshot.breakdowns),
        trace: [],
        plan,
      },
      executionStatus: 'QUEUED',
      ...(snapshot.budget
        ? {
            maxBudget: {
              currency: snapshot.budget.currency,
              amount: snapshot.budget.maxAmount,
            },
          }
        : {}),
    };
    productionJobs.set(job.id, job);
    resumed.push(job.id);
  }
  return resumed;
}

function optionalBudget(record: Record<string, unknown>): { currency: string; amount: number } | undefined {
  if (record.maxBudget === undefined) return undefined;
  const amount = record.maxBudget;
  const currency = record.budgetCurrency ?? productionCostRates.currency;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('maxBudget must be a positive number');
  }
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/u.test(currency)) {
    throw new Error('budgetCurrency must be an ISO-4217 code');
  }
  return { currency, amount };
}

function costRatesFromEnvironment(): ProductionCostRates {
  return {
    currency: process.env.PRODUCTION_COST_CURRENCY ?? 'CNY',
    imageGeneration: nonnegativeEnvironment('PRODUCTION_COST_IMAGE', 0),
    videoSecond: nonnegativeEnvironment('PRODUCTION_COST_VIDEO_SECOND', 0),
    ttsCharacter: nonnegativeEnvironment('PRODUCTION_COST_TTS_CHARACTER', 0),
    musicSecond: nonnegativeEnvironment('PRODUCTION_COST_MUSIC_SECOND', 0),
    sfxSecond: nonnegativeEnvironment('PRODUCTION_COST_SFX_SECOND', 0),
    mediaJob: nonnegativeEnvironment('PRODUCTION_COST_MEDIA_JOB', 0),
  };
}

function nonnegativeEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be non-negative`);
  return parsed;
}

function referenceAssetUriMap(): Record<string, string> {
  const configured = process.env.CANONICAL_ASSET_URI_MAP_JSON;
  if (!configured) return {};
  const parsed = JSON.parse(configured) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((value) => typeof value === 'string' && /^(?:https:|file:)/u.test(value))
  ) {
    throw new Error('CANONICAL_ASSET_URI_MAP_JSON must map asset IDs to HTTPS/file URIs');
  }
  return parsed as Record<string, string>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be positive`);
  return parsed;
}

function authorize(request: IncomingMessage): boolean {
  const expected = process.env.ORCHESTRATOR_API_TOKEN;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const actual = request.headers.authorization?.replace(/^Bearer\s+/iu, '') ?? '';
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1_000_000) throw new Error('Request body exceeds 1 MB');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON object required');
  }
  return parsed as Record<string, unknown>;
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) {
    throw new Error(`${field} must contain ${minimum}-${maximum} characters`);
  }
  return value.trim();
}

function integerField(
  record: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[field];
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function storyField(record: Record<string, unknown>): StoryModel {
  const value = record.story;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('story must be a Story Model object');
  }
  return value as StoryModel;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid port ${value}`);
  }
  return parsed;
}

function applyCors(response: ServerResponse): void {
  response.setHeader(
    'access-control-allow-origin',
    process.env.CREATOR_CONSOLE_ORIGIN ?? 'http://127.0.0.1:3000',
  );
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  if (body === null) {
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}
