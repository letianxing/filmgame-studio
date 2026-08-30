import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JobGraph } from '@filmgame/job-engine';
import type {
  ImageGenerationRequest,
  ImageProvider,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  VideoGenerationRequest,
  VideoProvider,
} from '@filmgame/provider-sdk';
import type { GeneratedAsset } from '@filmgame/provider-sdk';
import type { ProductionJob, ProductionJobType } from '@filmgame/shared-types';
import { LocalStorageProvider } from '@filmgame/storage-service';

import {
  createMediaAssetHandlers,
  ProductionOrchestrator,
  type ProductionPlan,
} from '../src/index.js';

class FixtureImageProvider implements ImageProvider {
  readonly id = 'fixture-image';
  readonly kind = 'IMAGE' as const;
  health(): Promise<ProviderHealth> {
    return Promise.resolve({ status: 'HEALTHY', checkedAt: new Date().toISOString() });
  }
  generateImage(
    _request: ImageGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    return Promise.resolve(result(context, 'data:image/png;base64,iVBORw0KGgo=', 'image/png', this.id));
  }
}

class FixtureVideoProvider implements VideoProvider {
  readonly id = 'fixture-video';
  readonly kind = 'VIDEO' as const;
  firstFrameUri: string | undefined;
  health(): Promise<ProviderHealth> {
    return Promise.resolve({ status: 'HEALTHY', checkedAt: new Date().toISOString() });
  }
  generateVideo(
    request: VideoGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    this.firstFrameUri = request.firstFrameUri;
    return Promise.resolve(result(context, 'data:video/mp4;base64,AAAAHGZ0eXA=', 'video/mp4', this.id));
  }
}

test('media handlers persist an image then pass its immutable URI into video generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-assets-'));
  const imageProvider = new FixtureImageProvider();
  const videoProvider = new FixtureVideoProvider();
  try {
    const jobs: ProductionJob[] = [
      {
        id: 'image-shot-1',
        type: 'IMAGE',
        status: 'READY',
        dependencies: [],
        attempt: 0,
        maxAttempts: 2,
        input: { imagePrompt: 'snowbound hotel', width: 768, height: 432 },
      },
      {
        id: 'video-shot-1',
        type: 'VIDEO',
        status: 'PENDING',
        dependencies: ['image-shot-1'],
        attempt: 0,
        maxAttempts: 2,
        input: { videoPrompt: 'slow camera push', durationSeconds: 2 },
      },
    ];
    const plan: ProductionPlan = {
      projectId: 'project-test',
      storyVersion: 1,
      productionVersion: 1,
      graph: new JobGraph(jobs),
      summary: Object.fromEntries(productionTypes.map((type) => [type, 0])) as Record<
        ProductionJobType,
        number
      >,
    };
    const handlers = createMediaAssetHandlers(plan, {
      image: imageProvider,
      video: videoProvider,
      storage: new LocalStorageProvider({ rootDirectory: root }),
    });
    const orchestrator = new ProductionOrchestrator(plan, handlers);

    assert.equal(await orchestrator.runReady(), 1);
    assert.equal(await orchestrator.runReady(), 1);
    assert.equal(plan.graph.get('video-shot-1').status, 'SUCCEEDED');
    assert.match(videoProvider.firstFrameUri ?? '', /^file:/u);
    assert.match(String(plan.graph.get('video-shot-1').output?.sha256), /^[a-f0-9]{64}$/u);
    const generation = plan.graph.get('video-shot-1').output?.generationRecord as Record<string, unknown>;
    assert.equal(generation.provider, 'fixture-video');
    assert.equal(generation.resolvedPrompt, 'slow camera push');
    assert.equal(generation.attempt, 1);
    assert.ok(Array.isArray(generation.referenceAssets));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('locked canonical references cannot be silently dropped by an image provider', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-locked-reference-'));
  const job: ProductionJob = {
    id: 'character-reference', type: 'IMAGE', status: 'READY', dependencies: [],
    attempt: 0, maxAttempts: 1,
    input: { imagePrompt: 'locked character', canonicalReferenceAssetIds: ['locked-reference'] },
  };
  const plan: ProductionPlan = {
    projectId: 'project-test', storyVersion: 1, productionVersion: 1,
    graph: new JobGraph([job]),
    summary: Object.fromEntries(productionTypes.map((type) => [type, 0])) as Record<ProductionJobType, number>,
  };
  try {
    const handlers = createMediaAssetHandlers(plan, {
      image: new FixtureImageProvider(), video: new FixtureVideoProvider(),
      storage: new LocalStorageProvider({ rootDirectory: root }),
    });
    await new ProductionOrchestrator(plan, handlers).runUntilSettled(1);
    assert.equal(plan.graph.get(job.id).status, 'FAILED');
    assert.match(plan.graph.get(job.id).error ?? '', /cannot be silently dropped/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function result(
  context: ProviderContext,
  temporaryUri: string,
  mimeType: string,
  provider: string,
): ProviderResult<GeneratedAsset> {
  const now = new Date().toISOString();
  return {
    data: { temporaryUri, mimeType },
    provider,
    requestId: context.requestId,
    startedAt: now,
    completedAt: now,
    metadata: {},
  };
}

const productionTypes: ProductionJobType[] = [
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
];
