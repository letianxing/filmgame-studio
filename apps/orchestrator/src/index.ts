import { hashJobInput, JobGraph } from '@filmgame/job-engine';
import { buildCanonicalBible } from '@filmgame/consistency-engine';
import type {
  EntityId,
  JsonValue,
  ProductionJob,
  ProductionJobType,
  StoryModel,
} from '@filmgame/shared-types';

export * from './story-workflow.js';
export * from './asset-handlers.js';
export * from './finalization-handlers.js';
export * from './audit-sinks.js';
export * from './run-store.js';
export * from './failure-messages.js';

export interface ShotBreakdown {
  id: EntityId;
  sceneId: EntityId;
  characterIds: EntityId[];
  locationId: EntityId;
  description: string;
  dialogue: Array<{ characterId: EntityId; text: string }>;
  camera: string;
  durationSeconds: number;
  imagePrompt: string;
  videoPrompt: string;
}

export interface SceneBreakdown {
  sceneId: EntityId;
  entityType?: 'SCENE' | 'ENDING';
  shots: ShotBreakdown[];
}

export interface ProductionPlan {
  projectId: EntityId;
  storyVersion: number;
  productionVersion: number;
  graph: JobGraph;
  summary: Record<ProductionJobType, number>;
}

export interface ProductionCostRates {
  currency: string;
  imageGeneration: number;
  videoSecond: number;
  ttsCharacter: number;
  musicSecond: number;
  sfxSecond: number;
  mediaJob: number;
}

export interface ProductionCostEstimate {
  currency: string;
  baseAmount: number;
  retryReserveAmount: number;
  maximumAmount: number;
  imageGenerations: number;
  videoSeconds: number;
  ttsCharacters: number;
  musicSeconds: number;
  sfxSeconds: number;
}

export function estimateProductionCost(
  plan: ProductionPlan,
  rates: ProductionCostRates,
): ProductionCostEstimate {
  if (!/^[A-Z]{3}$/u.test(rates.currency)) throw new Error('Cost currency must be ISO-4217');
  for (const [name, value] of Object.entries(rates)) {
    if (name !== 'currency' && (!Number.isFinite(value) || Number(value) < 0)) {
      throw new Error(`Invalid production cost rate ${name}`);
    }
  }
  let imageGenerations = 0;
  let videoSeconds = 0;
  let ttsCharacters = 0;
  let musicSeconds = 0;
  let sfxSeconds = 0;
  let baseAmount = 0;
  let maximumAmount = 0;
  for (const job of plan.graph.list()) {
    const cost = estimateJobCost(job, rates);
    baseAmount += cost;
    maximumAmount += cost * Math.max(1, job.maxAttempts);
    if (job.type === 'IMAGE' || job.type === 'STORYBOARD') imageGenerations += 1;
    if (job.type === 'VIDEO') videoSeconds += numericInput(job, 'durationSeconds');
    if (job.type === 'MUSIC') musicSeconds += numericInput(job, 'durationSeconds');
    if (job.type === 'SFX') sfxSeconds += numericInput(job, 'durationSeconds');
    if (job.type === 'TTS') ttsCharacters += dialogueCharacters(job);
  }
  return {
    currency: rates.currency,
    baseAmount: roundMoney(baseAmount),
    retryReserveAmount: roundMoney(maximumAmount - baseAmount),
    maximumAmount: roundMoney(maximumAmount),
    imageGenerations,
    videoSeconds,
    ttsCharacters,
    musicSeconds,
    sfxSeconds,
  };
}

export function estimateJobCost(job: ProductionJob, rates: ProductionCostRates): number {
  if (job.type === 'IMAGE' || job.type === 'STORYBOARD') return rates.imageGeneration;
  if (job.type === 'VIDEO') return numericInput(job, 'durationSeconds') * rates.videoSecond;
  if (job.type === 'TTS') return dialogueCharacters(job) * rates.ttsCharacter;
  if (job.type === 'MUSIC') return numericInput(job, 'durationSeconds') * rates.musicSecond;
  if (job.type === 'SFX') return numericInput(job, 'durationSeconds') * rates.sfxSecond;
  if (job.type === 'MEDIA_RENDER' || job.type === 'QA' || job.type === 'PACKAGE') return rates.mediaJob;
  return 0;
}

export interface JobHandler {
  run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>>;
}

export type HandlerRegistry = Partial<Record<ProductionJobType, JobHandler>>;

export type ProductionResource = 'GENERATIVE_GPU' | 'MEDIA_CPU' | 'GENERAL';

export interface ProductionOrchestratorOptions {
  resourceConcurrency?: Partial<Record<ProductionResource, number>>;
  auditSink?: ProductionAuditSink;
  runStore?: import('./run-store.js').ProductionRunStore;
  runId?: string;
  snapshotContext?: { story: StoryModel; breakdowns: SceneBreakdown[] };
  budget?: { currency: string; maxAmount: number };
  estimateCost?: (job: ProductionJob) => number;
  initialBudgetState?: { reservedAmount: number; actualAmount: number };
}

export interface ProductionAuditEvent {
  eventId: string;
  jobId: EntityId;
  jobType: ProductionJobType;
  status: 'STARTED' | 'SUCCEEDED' | 'FAILED';
  attempt: number;
  occurredAt: string;
  durationMs?: number;
  error?: string;
}

export interface ProductionAuditSink {
  record(event: ProductionAuditEvent): Promise<void> | void;
}

export class InMemoryProductionAuditSink implements ProductionAuditSink {
  readonly #events: ProductionAuditEvent[] = [];

  record(event: ProductionAuditEvent): void {
    this.#events.push(structuredClone(event));
  }

  list(): ProductionAuditEvent[] {
    return structuredClone(this.#events);
  }
}

export function createProductionPlan(
  story: StoryModel,
  productionVersion: number,
  breakdowns: SceneBreakdown[],
): ProductionPlan {
  assertBreakdowns(story, breakdowns);
  const bible = story.canonicalBible ?? buildCanonicalBible(story);
  const jobs: ProductionJob[] = [];
  const directorJob = job('director-breakdown', 'DIRECTOR_BREAKDOWN', [], {
    storyVersion: story.storyVersion,
  });
  jobs.push(directorJob);

  const characterReferences = new Map<EntityId, EntityId>();
  for (const character of story.characters) {
    const id = `character-reference-${character.id}`;
    characterReferences.set(character.id, id);
    const canonicalCharacter = bible.characters.find((candidate) => candidate.characterId === character.id)!;
    const canonicalCostumes = bible.costumes.filter((candidate) => candidate.characterId === character.id);
    jobs.push(
      job(id, 'IMAGE', [directorJob.id], {
        purpose: 'CHARACTER_REFERENCE',
        characterId: character.id,
        assetLockRevision: character.assetLock?.revision ?? 1,
        bibleVersion: bible.bibleVersion,
        canonicalRecordId: canonicalCharacter.id,
        canonicalReferenceAssetIds: canonicalCharacter.canonicalReferenceAssetIds,
        costumeIds: canonicalCostumes.map((costume) => costume.costumeId),
        face: canonicalCharacter.face,
        hair: canonicalCharacter.hair,
        body: canonicalCharacter.body,
        imagePrompt:
          character.visual.promptTemplate ??
          `${story.visualBible.style}; full-body character reference for ${character.name}; ${character.visual.appearance}; ${character.visual.costume}`,
        negativePrompt: [...character.visual.constraints, ...(character.assetLock?.constraints ?? [])].join(', '),
        width: 768,
        height: 1024,
      }),
    );
  }

  const locationReferences = new Map<EntityId, EntityId>();
  for (const location of story.locations) {
    const id = `location-reference-${location.id}`;
    locationReferences.set(location.id, id);
    const canonicalLocation = bible.locations.find((candidate) => candidate.locationId === location.id)!;
    jobs.push(
      job(id, 'IMAGE', [directorJob.id], {
        purpose: 'LOCATION_REFERENCE',
        locationId: location.id,
        assetLockRevision: location.assetLock.revision,
        bibleVersion: bible.bibleVersion,
        canonicalRecordId: canonicalLocation.id,
        canonicalReferenceAssetIds: canonicalLocation.canonicalReferenceAssetIds,
        layout: canonicalLocation.layout,
        materials: canonicalLocation.materials,
        lighting: canonicalLocation.lighting,
        imagePrompt: `${story.visualBible.style}; location reference for ${location.name}; ${location.description}; ${location.visual}`,
        negativePrompt: [...(location.constraints ?? []), ...location.assetLock.constraints].join(', '),
        width: 1024,
        height: 576,
      }),
    );
  }

  const sceneQaJobs: EntityId[] = [];
  for (const breakdown of breakdowns) {
    const shotRenderJobs: EntityId[] = [];
    const musicId = `music-${breakdown.sceneId}`;
    jobs.push(
      job(musicId, 'MUSIC', [directorJob.id], {
        sceneId: breakdown.sceneId,
        entityType: breakdown.entityType ?? 'SCENE',
        prompt: `${story.narrativeTone}; ${story.visualBible.style}; cinematic underscore without vocals`,
        durationSeconds: breakdown.shots.reduce(
          (total, shot) => total + shot.durationSeconds,
          0,
        ),
      }),
    );
    for (const shot of breakdown.shots) {
      const referenceDependencies = [
        directorJob.id,
        locationReferences.get(shot.locationId)!,
        ...shot.characterIds.map((id) => characterReferences.get(id)!),
      ];
      const storyboardId = `storyboard-${shot.id}`;
      const imageId = `image-${shot.id}`;
      const videoId = `video-${shot.id}`;
      const ttsId = `tts-${shot.id}`;
      const subtitleId = `subtitle-${shot.id}`;
      const sfxId = `sfx-${shot.id}`;
      const renderId = `render-${shot.id}`;

      jobs.push(
        job(storyboardId, 'STORYBOARD', referenceDependencies, shotInput(shot, bible)),
        job(imageId, 'IMAGE', [storyboardId], shotInput(shot, bible)),
        job(videoId, 'VIDEO', [imageId], shotInput(shot, bible)),
        job(ttsId, 'TTS', [directorJob.id], {
          shotId: shot.id,
          dialogue: shot.dialogue,
          durationSeconds: shot.durationSeconds,
        }),
        job(subtitleId, 'SUBTITLE', [ttsId], {
          shotId: shot.id,
          dialogue: shot.dialogue,
          durationSeconds: shot.durationSeconds,
        }),
        job(sfxId, 'SFX', [directorJob.id], {
          shotId: shot.id,
          prompt: `cinematic environmental sound effects for ${shot.description}`,
          durationSeconds: shot.durationSeconds,
        }),
        job(renderId, 'MEDIA_RENDER', [videoId, ttsId, subtitleId, musicId, sfxId], {
          purpose: 'SHOT_RENDER',
          shotId: shot.id,
          sceneId: shot.sceneId,
          durationSeconds: shot.durationSeconds,
        }),
      );
      shotRenderJobs.push(renderId);
    }

    const sceneRenderId = `scene-render-${breakdown.sceneId}`;
    jobs.push(
      job(sceneRenderId, 'MEDIA_RENDER', shotRenderJobs, {
        purpose: 'SCENE_ASSEMBLY',
        sceneId: breakdown.sceneId,
        entityType: breakdown.entityType ?? 'SCENE',
      }),
    );
    const qaId = `qa-${breakdown.sceneId}`;
    jobs.push(
      job(qaId, 'QA', [sceneRenderId], {
        sceneId: breakdown.sceneId,
        entityType: breakdown.entityType ?? 'SCENE',
      }),
    );
    sceneQaJobs.push(qaId);
  }

  jobs.push(
    job('runtime-package', 'PACKAGE', sceneQaJobs, {
      storyVersion: story.storyVersion,
      productionVersion,
      targets: ['COLYSEUS', 'COMPANION_WEB', 'UNREAL_WINDOWS', 'PLAYTEST'],
    }),
  );

  const summary = Object.fromEntries(
    [
      'DIRECTOR_BREAKDOWN',
      'STORYBOARD',
      'IMAGE',
      'VIDEO',
      'TTS',
      'SUBTITLE',
      'MUSIC',
      'SFX',
      'MEDIA_RENDER',
      'QA',
      'PACKAGE',
    ].map((type) => [type, jobs.filter((candidate) => candidate.type === type).length]),
  ) as Record<ProductionJobType, number>;

  return {
    projectId: story.projectId,
    storyVersion: story.storyVersion,
    productionVersion,
    graph: new JobGraph(jobs),
    summary,
  };
}

export class ProductionOrchestrator {
  readonly #controllers = new Map<EntityId, AbortController>();
  #reservedCost = 0;
  #actualCost = 0;

  constructor(
    readonly plan: ProductionPlan,
    readonly handlers: HandlerRegistry,
    readonly options: ProductionOrchestratorOptions = {},
  ) {
    this.#reservedCost = Math.max(0, options.initialBudgetState?.reservedAmount ?? 0);
    this.#actualCost = Math.max(0, options.initialBudgetState?.actualAmount ?? 0);
  }

  async runReady(concurrency = 2): Promise<number> {
    const selected = selectByResource(
      this.plan.graph.ready(),
      Math.max(1, concurrency),
      this.options.resourceConcurrency,
    );
    const ready: ProductionJob[] = [];
    for (const job of selected) {
      const estimate = Math.max(0, this.options.estimateCost?.(job) ?? 0);
      const budget = this.options.budget;
      if (budget && this.#actualCost + this.#reservedCost + estimate > budget.maxAmount) {
        this.plan.graph.pause(job.id, `Budget ${budget.currency} ${budget.maxAmount} would be exceeded`);
        await this.#persist('PAUSED_BUDGET');
        continue;
      }
      this.#reservedCost += estimate;
      ready.push(job);
    }
    await Promise.all(ready.map((job) => this.#runJob(job)));
    return selected.length;
  }

  async runUntilSettled(concurrency = 2): Promise<{
    completed: number;
    failed: number;
    blocked: number;
    cancelled: number;
    paused: number;
    total: number;
  }> {
    const maximumCycles = this.plan.graph
      .list()
      .reduce((total, job) => total + Math.max(1, job.maxAttempts), 0);
    for (let cycle = 0; cycle < maximumCycles; cycle += 1) {
      if ((await this.runReady(concurrency)) === 0) break;
    }
    const jobs = this.plan.graph.list();
    const summary = {
      completed: jobs.filter((job) => job.status === 'SUCCEEDED').length,
      failed: jobs.filter((job) => job.status === 'FAILED').length,
      blocked: jobs.filter((job) => job.status === 'BLOCKED').length,
      cancelled: jobs.filter((job) => job.status === 'CANCELLED').length,
      paused: jobs.filter((job) => job.status === 'PAUSED').length,
      total: jobs.length,
    };
    await this.#persist(
      summary.paused
        ? 'PAUSED_BUDGET'
        : summary.failed || summary.blocked
          ? 'FAILED'
          : 'SUCCEEDED',
    );
    return summary;
  }

  cancel(jobId: EntityId): void {
    this.#controllers.get(jobId)?.abort(new Error(`Job ${jobId} was cancelled`));
    const job = this.plan.graph.get(jobId);
    if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      this.plan.graph.cancel(jobId);
    }
  }

  async #runJob(candidate: ProductionJob): Promise<void> {
    const handler = this.handlers[candidate.type];
    const job = this.plan.graph.start(candidate.id);
    await this.#persist('RUNNING');
    if (!handler) {
      this.plan.graph.fail(job.id, `No handler registered for ${job.type}`);
      return;
    }

    const controller = new AbortController();
    this.#controllers.set(job.id, controller);
    const started = performance.now();
    await this.#recordAudit({
      eventId: crypto.randomUUID(),
      jobId: job.id,
      jobType: job.type,
      status: 'STARTED',
      attempt: job.attempt,
      occurredAt: new Date().toISOString(),
    });
    try {
      const output = await handler.run(job, controller.signal);
      this.plan.graph.succeed(job.id, output);
      const actual = costFromOutput(output);
      const estimate = Math.max(0, this.options.estimateCost?.(job) ?? 0);
      this.#actualCost += actual > 0 ? actual : estimate;
      this.#reservedCost = Math.max(0, this.#reservedCost - estimate);
      await this.#persist('RUNNING');
      await this.#recordAudit({
        eventId: crypto.randomUUID(),
        jobId: job.id,
        jobType: job.type,
        status: 'SUCCEEDED',
        attempt: job.attempt,
        occurredAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.plan.graph.fail(job.id, message);
      this.#reservedCost = Math.max(0, this.#reservedCost - (this.options.estimateCost?.(job) ?? 0));
      await this.#persist('RUNNING');
      await this.#recordAudit({
        eventId: crypto.randomUUID(),
        jobId: job.id,
        jobType: job.type,
        status: 'FAILED',
        attempt: job.attempt,
        occurredAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started),
        error: message,
      });
    } finally {
      this.#controllers.delete(job.id);
    }
  }

  async #recordAudit(event: ProductionAuditEvent): Promise<void> {
    try {
      await this.options.auditSink?.record(event);
    } catch {
      // Audit transport failures must be surfaced by provider health, not corrupt job state.
    }
  }

  async #persist(executionStatus: import('./run-store.js').ProductionRunExecutionStatus): Promise<void> {
    const store = this.options.runStore;
    const context = this.options.snapshotContext;
    const runId = this.options.runId;
    if (!store || !context || !runId) return;
    await store.save({
      schemaVersion: '1.0.0',
      runId,
      projectId: this.plan.projectId,
      storyVersion: this.plan.storyVersion,
      productionVersion: this.plan.productionVersion,
      executionStatus,
      updatedAt: new Date().toISOString(),
      story: structuredClone(context.story),
      breakdowns: structuredClone(context.breakdowns),
      jobs: this.plan.graph.list(),
      transitions: this.plan.graph.transitions(),
      ...(this.options.budget
        ? {
            budget: {
              currency: this.options.budget.currency,
              maxAmount: this.options.budget.maxAmount,
              reservedAmount: this.#reservedCost,
              actualAmount: this.#actualCost,
            },
          }
        : {}),
    });
  }
}

function costFromOutput(output: Record<string, JsonValue>): number {
  const usage = output.providerUsage;
  if (!Array.isArray(usage)) return 0;
  return usage.reduce<number>((total, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return total;
    const value = entry.estimatedCost;
    return total + (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
}

function selectByResource(
  ready: ProductionJob[],
  concurrency: number,
  configured: ProductionOrchestratorOptions['resourceConcurrency'],
): ProductionJob[] {
  const limits: Record<ProductionResource, number> = {
    GENERATIVE_GPU: configured?.GENERATIVE_GPU ?? 1,
    MEDIA_CPU: configured?.MEDIA_CPU ?? 2,
    GENERAL: configured?.GENERAL ?? concurrency,
  };
  for (const [resource, limit] of Object.entries(limits)) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Invalid ${resource} concurrency ${limit}`);
    }
  }
  const selected: ProductionJob[] = [];
  const counts: Record<ProductionResource, number> = {
    GENERATIVE_GPU: 0,
    MEDIA_CPU: 0,
    GENERAL: 0,
  };
  for (const job of ready) {
    if (selected.length >= concurrency) break;
    const resource = resourceFor(job.type);
    if (counts[resource] >= limits[resource]) continue;
    counts[resource] += 1;
    selected.push(job);
  }
  return selected;
}

function resourceFor(type: ProductionJobType): ProductionResource {
  if (['STORYBOARD', 'IMAGE', 'VIDEO', 'TTS', 'MUSIC', 'SFX'].includes(type)) {
    return 'GENERATIVE_GPU';
  }
  if (['SUBTITLE', 'MEDIA_RENDER'].includes(type)) return 'MEDIA_CPU';
  return 'GENERAL';
}

function job(
  id: EntityId,
  type: ProductionJobType,
  dependencies: EntityId[],
  input: Record<string, JsonValue>,
): ProductionJob {
  return {
    id,
    type,
    status: dependencies.length ? 'PENDING' : 'READY',
    dependencies,
    attempt: 0,
    maxAttempts: type === 'VIDEO' ? 3 : 2,
    inputHash: hashJobInput(input),
    dependencyHash: hashJobInput({ dependencies }),
    progress: 0,
    input,
  };
}

function shotInput(
  shot: ShotBreakdown,
  bible: import('@filmgame/shared-types').CanonicalBible,
): Record<string, JsonValue> {
  const characterRecords = bible.characters.filter((record) => shot.characterIds.includes(record.characterId));
  const locationRecord = bible.locations.find((record) => record.locationId === shot.locationId);
  return {
    shotId: shot.id,
    sceneId: shot.sceneId,
    characterIds: shot.characterIds,
    locationId: shot.locationId,
    bibleVersion: bible.bibleVersion,
    canonicalCharacterRecordIds: characterRecords.map((record) => record.id),
    canonicalLocationRecordId: locationRecord?.id ?? shot.locationId,
    canonicalReferenceAssetIds: [
      ...characterRecords.flatMap((record) => record.canonicalReferenceAssetIds),
      ...(locationRecord?.canonicalReferenceAssetIds ?? []),
    ],
    lockRevisions: Object.fromEntries([
      ...characterRecords.map((record) => [record.id, record.revision]),
      ...(locationRecord ? [[locationRecord.id, locationRecord.revision] as const] : []),
    ]),
    description: shot.description,
    camera: shot.camera,
    durationSeconds: shot.durationSeconds,
    imagePrompt: shot.imagePrompt,
    videoPrompt: shot.videoPrompt,
    width: 1024,
    height: 576,
  };
}

function numericInput(job: ProductionJob, key: string): number {
  const value = job.input?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function dialogueCharacters(job: ProductionJob): number {
  const dialogue = job.input?.dialogue;
  if (!Array.isArray(dialogue)) return 0;
  return dialogue.reduce<number>((total, line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return total;
    return total + (typeof line.text === 'string' ? [...line.text].length : 0);
  }, 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function assertBreakdowns(story: StoryModel, breakdowns: SceneBreakdown[]): void {
  const sceneIds = new Set(story.scenes.map((scene) => scene.id));
  const endingIds = new Set(story.endings.map((ending) => ending.id));
  const characterIds = new Set(story.characters.map((character) => character.id));
  const locationIds = new Set(story.locations.map((location) => location.id));
  const shotIds = new Set<EntityId>();

  for (const breakdown of breakdowns) {
    const expectedType = breakdown.entityType ?? 'SCENE';
    if (
      (expectedType === 'SCENE' && !sceneIds.has(breakdown.sceneId)) ||
      (expectedType === 'ENDING' && !endingIds.has(breakdown.sceneId))
    ) {
      throw new Error(`Breakdown references unknown ${expectedType.toLowerCase()} ${breakdown.sceneId}`);
    }
    if (!breakdown.shots.length) throw new Error(`Scene ${breakdown.sceneId} has no shots`);
    for (const shot of breakdown.shots) {
      if (shot.sceneId !== breakdown.sceneId) {
        throw new Error(`Shot ${shot.id} belongs to ${shot.sceneId}, expected ${breakdown.sceneId}`);
      }
      if (shotIds.has(shot.id)) throw new Error(`Duplicate shot ${shot.id}`);
      shotIds.add(shot.id);
      if (shot.durationSeconds <= 0 || shot.durationSeconds > 10) {
        throw new Error(`Shot ${shot.id} duration must be within 0-10 seconds`);
      }
      if (!locationIds.has(shot.locationId)) throw new Error(`Shot ${shot.id} has unknown location`);
      for (const characterId of shot.characterIds) {
        if (!characterIds.has(characterId)) {
          throw new Error(`Shot ${shot.id} has unknown character ${characterId}`);
        }
      }
    }
  }
}
