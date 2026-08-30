import type {
  GeneratedAsset,
  ImageProvider,
  MusicProvider,
  ProviderContext,
  StorageProvider,
  SFXProvider,
  TTSProvider,
  VideoProvider,
} from '@filmgame/provider-sdk';
import type { JsonValue, ProductionJob, StoryModel } from '@filmgame/shared-types';

import type { HandlerRegistry, JobHandler, ProductionPlan } from './index.js';

export interface MediaAssetProviders {
  image: ImageProvider;
  video: VideoProvider;
  storage: StorageProvider;
  referenceUriByAssetId?: Record<string, string>;
}

export interface VoiceAssetProviders {
  tts: TTSProvider;
  storage: StorageProvider;
  voiceReferenceUriByAssetId?: Record<string, string>;
}

export interface AudioAssetProviders {
  music: MusicProvider;
  sfx: SFXProvider;
  storage: StorageProvider;
}

export function createMediaAssetHandlers(
  plan: ProductionPlan,
  providers: MediaAssetProviders,
): HandlerRegistry {
  const image = new PersistingImageJobHandler(
    plan,
    providers.image,
    providers.storage,
    providers.referenceUriByAssetId,
  );
  return {
    STORYBOARD: image,
    IMAGE: image,
    VIDEO: new PersistingVideoJobHandler(plan, providers.video, providers.storage),
  };
}

export function createVoiceAssetHandlers(
  plan: ProductionPlan,
  story: StoryModel,
  providers: VoiceAssetProviders,
): HandlerRegistry {
  return {
    TTS: new PersistingTtsJobHandler(plan, story, providers),
    SUBTITLE: new SubtitleJobHandler(plan, providers.storage),
  };
}

export function createAudioAssetHandlers(
  plan: ProductionPlan,
  providers: AudioAssetProviders,
): HandlerRegistry {
  return {
    MUSIC: new PersistingMusicJobHandler(plan, providers.music, providers.storage),
    SFX: new PersistingSfxJobHandler(plan, providers.sfx, providers.storage),
  };
}

export class PersistingImageJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly provider: ImageProvider,
    readonly storage: StorageProvider,
    readonly referenceUriByAssetId: Record<string, string> = {},
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const input = requireInput(job);
    const prompt = stringInput(input, 'imagePrompt');
    const negativePrompt = optionalString(input, 'negativePrompt');
    const seed = optionalNumber(input, 'seed');
    const canonicalReferenceIds = stringArray(input.canonicalReferenceAssetIds);
    const unresolvedReferenceIds = canonicalReferenceIds.filter(
      (assetId) => !this.referenceUriByAssetId[assetId],
    );
    if (unresolvedReferenceIds.length) {
      throw new Error(
        `Canonical reference URI missing for ${unresolvedReferenceIds.join(', ')}; locked references cannot be silently dropped`,
      );
    }
    const referenceAssetUris = [
      ...stringArray(input.referenceAssetUris),
      ...canonicalReferenceIds.map((assetId) => this.referenceUriByAssetId[assetId]!),
    ];
    const context = providerContext(this.plan, job, signal);
    const result = await this.provider.generateImage(
      {
        prompt,
        ...(negativePrompt ? { negativePrompt } : {}),
        width: optionalNumber(input, 'width') ?? (job.type === 'STORYBOARD' ? 768 : 1024),
        height: optionalNumber(input, 'height') ?? (job.type === 'STORYBOARD' ? 432 : 576),
        referenceAssetUris,
        workflowId: optionalString(input, 'workflowId') ?? 'flux-schnell-fp8-v1',
        ...(seed !== undefined ? { seed } : {}),
      },
      context,
    );
    return {
      ...(await withGenerationRecord(
        this.plan,
        job,
        result,
        this.storage,
        context,
        {
          resolvedPrompt: prompt,
          negativePrompt: negativePrompt ?? '',
          referenceAssets: referenceAssetUris,
          parameters: {
            width: optionalNumber(input, 'width') ?? (job.type === 'STORYBOARD' ? 768 : 1024),
            height: optionalNumber(input, 'height') ?? (job.type === 'STORYBOARD' ? 432 : 576),
          },
          seed: seed ?? null,
          workflowVersion: optionalString(input, 'workflowId') ?? 'flux-schnell-fp8-v1',
        },
      )),
      providerRequestId: result.requestId,
      providerModel: result.model ?? null,
      providerUsage: (result.usage ?? []) as unknown as JsonValue,
    };
  }
}

export class PersistingVideoJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly provider: VideoProvider,
    readonly storage: StorageProvider,
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const input = requireInput(job);
    const firstFrameUri = findDependencyAsset(this.plan, job, 'image/');
    const negativePrompt = optionalString(input, 'negativePrompt');
    const seed = optionalNumber(input, 'seed');
    const context = providerContext(this.plan, job, signal);
    const result = await this.provider.generateVideo(
      {
        prompt: stringInput(input, 'videoPrompt'),
        ...(negativePrompt ? { negativePrompt } : {}),
        durationSeconds: numberInput(input, 'durationSeconds'),
        ...(firstFrameUri ? { firstFrameUri } : {}),
        referenceAssetUris: [],
        workflowId: optionalString(input, 'workflowId') ?? 'wan2-2-ti2v-5b-v1',
        ...(seed !== undefined ? { seed } : {}),
      },
      context,
    );
    return {
      ...(await withGenerationRecord(
        this.plan,
        job,
        result,
        this.storage,
        context,
        {
          resolvedPrompt: stringInput(input, 'videoPrompt'),
          negativePrompt: negativePrompt ?? '',
          referenceAssets: [firstFrameUri].filter((value): value is string => Boolean(value)),
          parameters: { durationSeconds: numberInput(input, 'durationSeconds') },
          seed: seed ?? null,
          workflowVersion: optionalString(input, 'workflowId') ?? 'wan2-2-ti2v-5b-v1',
        },
      )),
      providerRequestId: result.requestId,
      providerModel: result.model ?? null,
      providerUsage: (result.usage ?? []) as unknown as JsonValue,
    };
  }
}

export class PersistingTtsJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly story: StoryModel,
    readonly providers: VoiceAssetProviders,
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const dialogue = dialogueInput(requireInput(job));
    const voiceAssets: JsonValue[] = [];
    for (const [index, line] of dialogue.entries()) {
      const character = this.story.characters.find((candidate) => candidate.id === line.characterId);
      if (!character) throw new Error(`Unknown dialogue character ${line.characterId}`);
      const referenceId = character.voice.voiceReferenceAssetId ?? undefined;
      const referenceAudioUri = referenceId
        ? this.providers.voiceReferenceUriByAssetId?.[referenceId]
        : undefined;
      const voiceId = character.voice.voiceId ?? undefined;
      if (!voiceId && !referenceAudioUri) {
        throw new Error(`Character ${character.id} has no approved voiceId or voice reference asset`);
      }
      const lineJob: ProductionJob = {
        ...job,
        id: `${job.id}-line-${String(index + 1).padStart(3, '0')}`,
      };
      const context = providerContext(this.plan, lineJob, signal);
      const result = await this.providers.tts.synthesize(
        {
          text: line.text,
          ...(voiceId ? { voiceId } : {}),
          ...(referenceAudioUri ? { referenceAudioUri } : {}),
          language: character.voice.language,
          style: character.voice.speakingStyle,
          emotion: character.voice.emotion,
          speed: character.voice.speed,
          outputFormat: 'WAV',
        },
        context,
      );
      const stored = await persistGeneratedAsset(
        this.plan,
        lineJob,
        result.data,
        result.provider,
        this.providers.storage,
        context,
      );
      voiceAssets.push({
        characterId: line.characterId,
        text: line.text,
        ...stored,
        providerRequestId: result.requestId,
        providerModel: result.model ?? null,
        providerUsage: (result.usage ?? []) as unknown as JsonValue,
        generationRecord: generationRecord(
          lineJob,
          result,
          stored,
          {
            resolvedPrompt: line.text,
            negativePrompt: '',
            referenceAssets: [referenceAudioUri].filter((value): value is string => Boolean(value)),
            parameters: {
              characterId: line.characterId,
              language: character.voice.language,
              style: character.voice.speakingStyle,
              emotion: character.voice.emotion,
              speed: character.voice.speed,
            },
            seed: null,
            workflowVersion: 'cosyvoice-tts-v1',
          },
        ),
      });
    }
    return { voiceAssets };
  }
}

export class SubtitleJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly storage: StorageProvider,
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const input = requireInput(job);
    const dialogue = dialogueInput(input);
    const durationSeconds = numberInput(input, 'durationSeconds');
    const subtitle = createSrt(dialogue, durationSeconds);
    const context = providerContext(this.plan, job, signal);
    const key = [
      'projects',
      this.plan.projectId,
      `story-v${this.plan.storyVersion}`,
      `production-v${this.plan.productionVersion}`,
      'subtitle',
      `${job.id}.srt`,
    ].join('/');
    const stored = await this.storage.put(
      key,
      new TextEncoder().encode(subtitle),
      'application/x-subrip',
      context,
    );
    return {
      assetId: job.id,
      assetUri: stored.data.uri,
      mimeType: stored.data.contentType,
      sha256: stored.data.sha256,
      sizeBytes: stored.data.sizeBytes,
      storageProvider: stored.provider,
    };
  }
}

export class PersistingMusicJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly provider: MusicProvider,
    readonly storage: StorageProvider,
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const input = requireInput(job);
    const context = providerContext(this.plan, job, signal);
    const result = await this.provider.generateMusic(
      {
        prompt: stringInput(input, 'prompt'),
        durationSeconds: numberInput(input, 'durationSeconds'),
        seamlessLoop: false,
      },
      context,
    );
    return {
      ...(await withGenerationRecord(this.plan, job, result, this.storage, context, {
        resolvedPrompt: stringInput(input, 'prompt'), negativePrompt: '', referenceAssets: [],
        parameters: { durationSeconds: numberInput(input, 'durationSeconds'), seamlessLoop: false },
        seed: null, workflowVersion: 'music-generation-v1',
      })),
      providerRequestId: result.requestId,
      providerModel: result.model ?? null,
      providerUsage: (result.usage ?? []) as unknown as JsonValue,
    };
  }
}

export class PersistingSfxJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly provider: SFXProvider,
    readonly storage: StorageProvider,
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const input = requireInput(job);
    const context = providerContext(this.plan, job, signal);
    const result = await this.provider.generateSfx(
      {
        prompt: stringInput(input, 'prompt'),
        durationSeconds: numberInput(input, 'durationSeconds'),
      },
      context,
    );
    return {
      ...(await withGenerationRecord(this.plan, job, result, this.storage, context, {
        resolvedPrompt: stringInput(input, 'prompt'), negativePrompt: '', referenceAssets: [],
        parameters: { durationSeconds: numberInput(input, 'durationSeconds') },
        seed: null, workflowVersion: 'sfx-generation-v1',
      })),
      providerRequestId: result.requestId,
      providerModel: result.model ?? null,
      providerUsage: (result.usage ?? []) as unknown as JsonValue,
    };
  }
}

interface GenerationRecordInput {
  resolvedPrompt: string;
  negativePrompt: string;
  referenceAssets: string[];
  parameters: Record<string, JsonValue>;
  seed: number | null;
  workflowVersion: string;
}

async function withGenerationRecord(
  plan: ProductionPlan,
  job: ProductionJob,
  result: import('@filmgame/provider-sdk').ProviderResult<GeneratedAsset>,
  storage: StorageProvider,
  context: ProviderContext,
  details: GenerationRecordInput,
): Promise<Record<string, JsonValue>> {
  const stored = await persistGeneratedAsset(plan, job, result.data, result.provider, storage, context);
  return { ...stored, generationRecord: generationRecord(job, result, stored, details) };
}

function generationRecord(
  job: ProductionJob,
  result: import('@filmgame/provider-sdk').ProviderResult<GeneratedAsset>,
  stored: Record<string, JsonValue>,
  details: GenerationRecordInput,
): JsonValue {
  const cost = (result.usage ?? []).reduce(
    (total, usage) => total + (usage.estimatedCost ?? 0),
    0,
  );
  return {
    provider: result.provider,
    model: result.model ?? 'unknown',
    modelVersion: String(result.metadata.modelVersion ?? result.model ?? 'unknown'),
    workflowVersion: details.workflowVersion,
    promptVersion: String(job.input?.promptVersion ?? 'v1'),
    resolvedPrompt: details.resolvedPrompt,
    negativePrompt: details.negativePrompt,
    seed: details.seed,
    referenceAssets: details.referenceAssets,
    inputHash: job.inputHash ?? 'legacy-input',
    parameters: details.parameters,
    outputAsset: {
      assetId: stored.assetId ?? job.id,
      assetUri: stored.assetUri ?? '',
      sha256: stored.sha256 ?? '',
    },
    cost,
    durationMs: Math.max(0, Date.parse(result.completedAt) - Date.parse(result.startedAt)),
    attempt: job.attempt,
    createdAt: result.completedAt,
  };
}

async function persistGeneratedAsset(
  plan: ProductionPlan,
  job: ProductionJob,
  asset: GeneratedAsset,
  sourceProvider: string,
  storage: StorageProvider,
  context: ProviderContext,
): Promise<Record<string, JsonValue>> {
  const response = await fetch(asset.temporaryUri, { signal: context.signal ?? null });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to retrieve generated asset for ${job.id}: HTTP ${response.status}`);
  }
  const mimeType = asset.mimeType || response.headers.get('content-type') || 'application/octet-stream';
  const key = [
    'projects',
    plan.projectId,
    `story-v${plan.storyVersion}`,
    `production-v${plan.productionVersion}`,
    job.type.toLowerCase(),
    `${job.id}.${extensionFor(mimeType)}`,
  ].join('/');
  const stored = await storage.put(key, response.body, mimeType, context);
  return {
    assetId: job.id,
    assetUri: stored.data.uri,
    mimeType: stored.data.contentType,
    sha256: stored.data.sha256,
    sizeBytes: stored.data.sizeBytes,
    sourceProvider,
    storageProvider: stored.provider,
  };
}

function providerContext(
  plan: ProductionPlan,
  job: ProductionJob,
  signal: AbortSignal,
): ProviderContext {
  return {
    requestId: `${job.id}-attempt-${job.attempt}`,
    projectId: plan.projectId,
    storyVersion: plan.storyVersion,
    productionVersion: plan.productionVersion,
    idempotencyKey: `${plan.projectId}:production-${plan.productionVersion}:${job.id}:${job.inputHash ?? 'legacy-input'}`,
    signal,
    metadata: { jobId: job.id, jobType: job.type },
  };
}

function findDependencyAsset(
  plan: ProductionPlan,
  job: ProductionJob,
  mimePrefix: string,
): string | undefined {
  for (const dependencyId of job.dependencies) {
    const output = plan.graph.get(dependencyId).output;
    if (
      output &&
      typeof output.assetUri === 'string' &&
      typeof output.mimeType === 'string' &&
      output.mimeType.startsWith(mimePrefix)
    ) {
      return output.assetUri;
    }
  }
  return undefined;
}

function requireInput(job: ProductionJob): Record<string, JsonValue> {
  if (!job.input) throw new Error(`Job ${job.id} has no input`);
  return job.input;
}

function stringInput(input: Record<string, JsonValue>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optionalString(input: Record<string, JsonValue>, name: string): string | undefined {
  const value = input[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberInput(input: Record<string, JsonValue>, name: string): number {
  const value = input[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function optionalNumber(input: Record<string, JsonValue>, name: string): number | undefined {
  const value = input[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : [];
}

function dialogueInput(
  input: Record<string, JsonValue>,
): Array<{ characterId: string; text: string }> {
  const value = input.dialogue;
  if (!Array.isArray(value)) throw new Error('dialogue must be an array');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('dialogue line must be an object');
    }
    return {
      characterId: stringInput(entry, 'characterId'),
      text: stringInput(entry, 'text'),
    };
  });
}

function createSrt(
  dialogue: Array<{ characterId: string; text: string }>,
  durationSeconds: number,
): string {
  if (!dialogue.length) return '';
  const segment = durationSeconds / dialogue.length;
  return `${dialogue
    .map((line, index) => {
      const start = index * segment;
      const end = Math.min(durationSeconds, (index + 1) * segment);
      return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${line.text}\n`;
    })
    .join('\n')}\n`;
}

function srtTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function extensionFor(mimeType: string): string {
  return (
    {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/wav': 'wav',
      'application/x-subrip': 'srt',
    }[mimeType] ?? 'bin'
  );
}
