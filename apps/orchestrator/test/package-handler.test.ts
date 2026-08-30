import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { JobGraph } from '@filmgame/job-engine';
import type { MediaPipeline } from '@filmgame/media-pipeline';
import type { ProductionJob, ProductionJobType, StoryModel } from '@filmgame/shared-types';
import { LocalStorageProvider } from '@filmgame/storage-service';

import {
  createFinalizationHandlers,
  ProductionOrchestrator,
  type ProductionPlan,
} from '../src/index.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

test('package handler emits four target packages and keeps missing endings non-publishable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-package-'));
  try {
    const qaJobs: ProductionJob[] = story.scenes.map((scene, index) => ({
      id: `qa-${scene.id}`,
      type: 'QA',
      status: 'SUCCEEDED',
      dependencies: [],
      attempt: 1,
      maxAttempts: 1,
      input: { sceneId: scene.id },
      output: {
        valid: true,
        assetId: `scene-render-${scene.id}`,
        assetUri: `https://assets.invalid/${scene.id}.mp4`,
        mimeType: 'video/mp4',
        sha256: String(index + 1).repeat(64).slice(0, 64),
        sizeBytes: 1024 + index,
      },
    }));
    const packageJob: ProductionJob = {
      id: 'runtime-package',
      type: 'PACKAGE',
      status: 'PENDING',
      dependencies: qaJobs.map((job) => job.id),
      attempt: 0,
      maxAttempts: 1,
    };
    const plan: ProductionPlan = {
      projectId: story.projectId,
      storyVersion: story.storyVersion,
      productionVersion: 1,
      graph: new JobGraph([...qaJobs, packageJob]),
      summary: Object.fromEntries(types.map((type) => [type, 0])) as Record<
        ProductionJobType,
        number
      >,
    };
    const storage = new LocalStorageProvider({ rootDirectory: path.join(root, 'assets') });
    const handlers = createFinalizationHandlers(plan, {
      media: {} as MediaPipeline,
      storage,
      workDirectory: path.join(root, 'work'),
      story,
      productionAssetsCommerciallyApproved: false,
    });
    const orchestrator = new ProductionOrchestrator(plan, handlers);
    await orchestrator.runReady();

    const output = plan.graph.get('runtime-package').output!;
    assert.equal(output.publishReady, false);
    assert.equal((output.missingEndingIds as string[]).length, story.endings.length);
    const manifest = JSON.parse(
      await readFile(fileURLToPath(String(output.assetManifestUri)), 'utf8'),
    ) as { runtimePackages: unknown[]; metadata: { publishable: boolean } };
    assert.equal(manifest.runtimePackages.length, 4);
    assert.equal(manifest.metadata.publishable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const types: ProductionJobType[] = [
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
