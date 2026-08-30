import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import type { MediaPipeline } from '@filmgame/media-pipeline';
import type { ProviderContext, StorageProvider } from '@filmgame/provider-sdk';
import { buildRuntimePackage } from '@filmgame/runtime-packager';
import type { JsonValue, ProductionJob, StoryModel } from '@filmgame/shared-types';

import type { HandlerRegistry, JobHandler, ProductionPlan } from './index.js';

export interface FinalizationServices {
  media: MediaPipeline;
  storage: StorageProvider;
  workDirectory: string;
  story?: StoryModel;
  productionAssetsCommerciallyApproved?: boolean;
  autoApproveQaAssets?: boolean;
}

export function createFinalizationHandlers(
  plan: ProductionPlan,
  services: FinalizationServices,
): HandlerRegistry {
  const handlers: HandlerRegistry = {
    DIRECTOR_BREAKDOWN: { run: async () => ({ planned: true }) },
    MEDIA_RENDER: new FinalSceneRenderJobHandler(plan, services),
    QA: new AssetQaJobHandler(plan),
  };
  if (services.story) {
    handlers.PACKAGE = new RuntimePackageJobHandler(plan, services.story, services);
  }
  return handlers;
}

export class FinalSceneRenderJobHandler implements JobHandler {
  readonly #workRoot: string;

  constructor(
    readonly plan: ProductionPlan,
    readonly services: FinalizationServices,
  ) {
    if (!path.isAbsolute(services.workDirectory)) {
      throw new Error('Media work directory must be absolute');
    }
    this.#workRoot = path.resolve(services.workDirectory);
  }

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    await mkdir(this.#workRoot, { recursive: true });
    const work = await mkdtemp(path.join(this.#workRoot, `${safeName(job.id)}-`));
    if (!work.startsWith(`${this.#workRoot}${path.sep}`)) throw new Error('Unsafe media work path');
    try {
      const dependencies = job.dependencies.map((id) => this.plan.graph.get(id));
      if (job.input?.purpose === 'SCENE_ASSEMBLY') {
        const partUris = dependencies.flatMap((dependency) =>
          typeof dependency.output?.assetUri === 'string' &&
          typeof dependency.output.mimeType === 'string' &&
          dependency.output.mimeType.startsWith('video/')
            ? [dependency.output.assetUri]
            : [],
        );
        if (!partUris.length) throw new Error(`Scene assembly ${job.id} has no shot videos`);
        const partPaths: string[] = [];
        for (const [index, uri] of partUris.entries()) {
          const partPath = path.join(work, `part-${String(index + 1).padStart(3, '0')}.mp4`);
          await materialize(uri, partPath, signal);
          partPaths.push(partPath);
        }
        const finalVideo = path.join(work, 'final.mp4');
        if (partPaths.length === 1) {
          await copyFile(partPaths[0]!, finalVideo);
        } else {
          const concatList = path.join(work, 'scene-parts.txt');
          await writeFile(
            concatList,
            `${partPaths.map((partPath) => `file '${path.basename(partPath)}'`).join('\n')}\n`,
            'utf8',
          );
          await this.services.media.concat({
            concatListPath: concatList,
            outputPath: finalVideo,
            signal,
          });
        }
        return this.#storeFinal(job, finalVideo, signal);
      }
      const videoUri = directAssetUri(dependencies, 'video/');
      if (!videoUri) throw new Error(`Render job ${job.id} has no video dependency`);
      const sourceVideo = path.join(work, 'source-video.mp4');
      await materialize(videoUri, sourceVideo, signal);

      const voiceUris = dependencies.flatMap((dependency) => voiceAssetUris(dependency.output));
      const generatedAudioUris = dependencies.flatMap((dependency) =>
        typeof dependency.output?.assetUri === 'string' &&
        typeof dependency.output.mimeType === 'string' &&
        dependency.output.mimeType.startsWith('audio/')
          ? [dependency.output.assetUri]
          : [],
      );
      let composedVideo = sourceVideo;
      const audioTracks: string[] = [];
      if (voiceUris.length) {
        const voicePaths: string[] = [];
        for (const [index, uri] of voiceUris.entries()) {
          const voicePath = path.join(work, `voice-${String(index + 1).padStart(3, '0')}.wav`);
          await materialize(uri, voicePath, signal);
          voicePaths.push(voicePath);
        }
        let audioPath = voicePaths[0]!;
        if (voicePaths.length > 1) {
          const concatList = path.join(work, 'voices.txt');
          await writeFile(
            concatList,
            `${voicePaths.map((voicePath) => `file '${path.basename(voicePath)}'`).join('\n')}\n`,
            'utf8',
          );
          audioPath = path.join(work, 'voices.wav');
          await this.services.media.concat({
            concatListPath: concatList,
            outputPath: audioPath,
            signal,
          });
        }
        audioTracks.push(audioPath);
      }
      for (const [index, uri] of generatedAudioUris.entries()) {
        const audioPath = path.join(work, `generated-audio-${String(index + 1).padStart(3, '0')}.wav`);
        await materialize(uri, audioPath, signal);
        audioTracks.push(audioPath);
      }
      if (audioTracks.length) {
        let mixedAudio = audioTracks[0]!;
        if (audioTracks.length > 1) {
          mixedAudio = path.join(work, 'mixed-audio.wav');
          await this.services.media.mixAudio({
            inputPaths: audioTracks,
            outputPath: mixedAudio,
            signal,
          });
        }
        composedVideo = path.join(work, 'muxed.mp4');
        await this.services.media.mux({
          videoPath: sourceVideo,
          audioPath: mixedAudio,
          outputPath: composedVideo,
          signal,
        });
      }

      const subtitleUri = directAssetUri(dependencies, 'application/x-subrip');
      const finalVideo = path.join(work, 'final.mp4');
      if (subtitleUri) {
        const subtitlePath = path.join(work, 'subtitles.srt');
        await materialize(subtitleUri, subtitlePath, signal);
        if ((await stat(subtitlePath)).size) {
          await this.services.media.burnSubtitles({
            inputPath: composedVideo,
            subtitlePath,
            outputPath: finalVideo,
            signal,
          });
        } else {
          await copyFile(composedVideo, finalVideo);
        }
      } else {
        await copyFile(composedVideo, finalVideo);
      }

      return this.#storeFinal(job, finalVideo, signal);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  async #storeFinal(
    job: ProductionJob,
    finalVideo: string,
    signal: AbortSignal,
  ): Promise<Record<string, JsonValue>> {
      const context = providerContext(this.plan, job, signal);
      const key = [
        'projects',
        this.plan.projectId,
        `story-v${this.plan.storyVersion}`,
        `production-v${this.plan.productionVersion}`,
        'final-scene',
        `${job.id}.mp4`,
      ].join('/');
      const stream = Readable.toWeb(createReadStream(finalVideo)) as unknown as ReadableStream<Uint8Array>;
      const stored = await this.services.storage.put(key, stream, 'video/mp4', context);
      return {
        assetId: job.id,
        assetUri: stored.data.uri,
        mimeType: stored.data.contentType,
        sha256: stored.data.sha256,
        sizeBytes: stored.data.sizeBytes,
        sourceProvider: 'ffmpeg-media-pipeline',
        storageProvider: stored.provider,
      };
  }
}

export class AssetQaJobHandler implements JobHandler {
  constructor(readonly plan: ProductionPlan) {}

  async run(job: ProductionJob): Promise<Record<string, JsonValue>> {
    const assets = job.dependencies
      .map((id) => this.plan.graph.get(id).output)
      .filter((output): output is Record<string, JsonValue> => Boolean(output));
    if (!assets.length) throw new Error(`QA job ${job.id} has no rendered assets`);
    for (const asset of assets) {
      if (
        typeof asset.assetUri !== 'string' ||
        typeof asset.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
        typeof asset.sizeBytes !== 'number' ||
        asset.sizeBytes <= 0
      ) {
        throw new Error(`QA job ${job.id} found an incomplete asset`);
      }
      if (new URL(asset.assetUri).protocol === 'file:') {
        const details = await stat(fileURLToPath(asset.assetUri));
        if (details.size !== asset.sizeBytes) throw new Error(`QA size mismatch for ${asset.assetId}`);
      }
    }
    const approved = assets[0]!;
    return {
      valid: true,
      checkedAssetIds: assets.map((asset) => String(asset.assetId)),
      assetId: String(approved.assetId),
      assetUri: String(approved.assetUri),
      mimeType: String(approved.mimeType),
      sha256: String(approved.sha256),
      sizeBytes: Number(approved.sizeBytes),
    };
  }
}

export class RuntimePackageJobHandler implements JobHandler {
  constructor(
    readonly plan: ProductionPlan,
    readonly story: StoryModel,
    readonly services: FinalizationServices,
  ) {}

  async run(job: ProductionJob, signal: AbortSignal): Promise<Record<string, JsonValue>> {
    const sceneAssets = job.dependencies.map((qaId) => {
      const qa = this.plan.graph.get(qaId);
      const sceneId = typeof qa.input?.sceneId === 'string' ? qa.input.sceneId : null;
      const entityType = qa.input?.entityType === 'ENDING' ? 'ENDING' : 'SCENE';
      const output = qa.output;
      if (
        !sceneId ||
        typeof output?.assetId !== 'string' ||
        typeof output.assetUri !== 'string' ||
        typeof output.mimeType !== 'string' ||
        typeof output.sha256 !== 'string' ||
        typeof output.sizeBytes !== 'number'
      ) {
        throw new Error(`Package dependency ${qaId} has no approved scene asset`);
      }
      return {
        sceneId,
        entityType,
        assetId: output.assetId,
        uri: output.assetUri,
        mimeType: output.mimeType,
        sha256: output.sha256,
        sizeBytes: output.sizeBytes,
      };
    });
    const videoAssetIdByEntityId = Object.fromEntries(
      sceneAssets.map((asset) => [asset.sceneId, asset.assetId]),
    );
    const runtime = buildRuntimePackage(this.story, {
      runtimeVersion: this.plan.productionVersion,
      assetManifestUri: 'asset-manifest.json',
      videoAssetIdByEntityId,
    });
    const context = providerContext(this.plan, job, signal);
    const prefix = [
      'projects',
      this.plan.projectId,
      `story-v${this.plan.storyVersion}`,
      `production-v${this.plan.productionVersion}`,
      'runtime',
    ].join('/');
    const runtimeStored = await this.services.storage.put(
      `${prefix}/runtime-package.json`,
      runtime.bytes,
      'application/json',
      context,
    );
    const storyDefinitionBytes = new TextEncoder().encode(`${JSON.stringify(this.story, null, 2)}\n`);
    const storyDefinitionStored = await this.services.storage.put(
      `runtime-definitions/${this.plan.projectId}/runtime-v${this.plan.productionVersion}/story.json`,
      storyDefinitionBytes,
      'application/json',
      context,
    );
    const approved = this.services.productionAssetsCommerciallyApproved ?? false;
    const qaApproved = this.services.autoApproveQaAssets ?? false;
    const missingEndings = this.story.endings.filter(
      (ending) => !videoAssetIdByEntityId[ending.id],
    );
    const runtimeAsset = {
      id: 'runtime-data',
      type: 'RUNTIME_DATA',
      uri: runtimeStored.data.uri,
      mimeType: 'application/json',
      sizeBytes: runtimeStored.data.sizeBytes,
      sha256: `sha256:${runtimeStored.data.sha256}`,
      status: 'GENERATED',
      dependencies: sceneAssets.map((asset) => asset.assetId),
      source: 'BUILT',
      providerMetadata: { provider: 'filmgame-runtime-packager' },
      license: { commercialUseApproved: true, licenseId: 'FIRST_PARTY' },
    };
    const finalSceneAssets = sceneAssets.map((asset) => ({
      id: asset.assetId,
      type: 'FINAL_SCENE',
      uri: asset.uri,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sha256: `sha256:${asset.sha256}`,
      status: qaApproved ? 'APPROVED' : 'QA',
      dependencies: [],
      source: 'DERIVED',
      entityType: asset.entityType,
      entityId: asset.sceneId,
      providerMetadata: { provider: 'filmgame-media-pipeline' },
      license: { commercialUseApproved: approved },
    }));
    const missingEndingAssets = missingEndings.map((ending) => ({
      id: `video-${ending.id}`,
      type: 'FINAL_SCENE',
      uri: `missing://video-${ending.id}.mp4`,
      mimeType: 'video/mp4',
      sizeBytes: 0,
      sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'MISSING',
      dependencies: [],
      source: 'GENERATED',
      entityType: 'ENDING',
      entityId: ending.id,
      providerMetadata: { provider: 'unconfigured' },
      license: { commercialUseApproved: false },
    }));
    const assetIds = [
      runtimeAsset.id,
      ...finalSceneAssets.map((asset) => asset.id),
      ...missingEndingAssets.map((asset) => asset.id),
    ];
    const targets = ['COLYSEUS', 'COMPANION_WEB', 'UNREAL_WINDOWS', 'PLAYTEST'];
    const packageReady = missingEndings.length === 0 && approved && qaApproved;
    const manifest = {
      schemaVersion: '1.0.0',
      manifestVersion: this.plan.productionVersion,
      projectId: this.plan.projectId,
      storyVersion: this.plan.storyVersion,
      productionVersion: this.plan.productionVersion,
      generatedAt: new Date().toISOString(),
      assets: [runtimeAsset, ...finalSceneAssets, ...missingEndingAssets],
      runtimePackages: targets.map((target) => ({
        id: `runtime-${target.toLowerCase().replace(/_/g, '-')}`,
        target,
        version: `${this.plan.storyVersion}.${this.plan.productionVersion}.0`,
        entryAssetId: runtimeAsset.id,
        assetIds,
        sha256: `sha256:${runtime.sha256}`,
        status: packageReady ? 'READY' : 'BUILDING',
      })),
      metadata: {
        publishable: packageReady,
        missingEndingIds: missingEndings.map((ending) => ending.id),
        productionAssetsCommerciallyApproved: approved,
        qaAssetsApproved: qaApproved,
      },
    };
    const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestStored = await this.services.storage.put(
      `${prefix}/asset-manifest.json`,
      manifestBytes,
      'application/json',
      context,
    );
    return {
      runtimePackageUri: runtimeStored.data.uri,
      runtimePackageSha256: runtimeStored.data.sha256,
      assetManifestUri: manifestStored.data.uri,
      assetManifestSha256: manifestStored.data.sha256,
      storyDefinitionUri: storyDefinitionStored.data.uri,
      storyDefinitionSha256: storyDefinitionStored.data.sha256,
      targets,
      publishReady: packageReady,
      missingEndingIds: missingEndings.map((ending) => ending.id),
    };
  }
}

function directAssetUri(jobs: ProductionJob[], mimePrefix: string): string | undefined {
  for (const job of jobs) {
    if (
      typeof job.output?.assetUri === 'string' &&
      typeof job.output.mimeType === 'string' &&
      job.output.mimeType.startsWith(mimePrefix)
    ) {
      return job.output.assetUri;
    }
  }
  return undefined;
}

function voiceAssetUris(output: ProductionJob['output']): string[] {
  if (!Array.isArray(output?.voiceAssets)) return [];
  return output.voiceAssets.flatMap((entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.assetUri === 'string'
      ? [entry.assetUri]
      : [],
  );
}

async function materialize(uri: string, destination: string, signal: AbortSignal): Promise<void> {
  const source = new URL(uri);
  if (source.protocol === 'file:') {
    await copyFile(fileURLToPath(source), destination);
    return;
  }
  const response = await fetch(source, { signal });
  if (!response.ok || !response.body) throw new Error(`Unable to download media: HTTP ${response.status}`);
  await streamPipeline(
    Readable.from(readWebChunks(response.body)),
    createWriteStream(destination, { flags: 'wx' }),
  );
}

async function* readWebChunks(
  source: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, void, void> {
  const reader = source.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
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
    idempotencyKey: `${plan.projectId}:production-${plan.productionVersion}:${job.id}:attempt-${job.attempt}`,
    signal,
  };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || 'render';
}
