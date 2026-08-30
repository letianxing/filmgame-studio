import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { JobGraph } from '@filmgame/job-engine';
import type { MediaPipeline } from '@filmgame/media-pipeline';
import type { ProductionJob, ProductionJobType } from '@filmgame/shared-types';
import { LocalStorageProvider } from '@filmgame/storage-service';

import {
  createFinalizationHandlers,
  ProductionOrchestrator,
  type ProductionPlan,
} from '../src/index.js';

test('finalization handler muxes, subtitles, stores, and QA-checks a final scene', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-finalization-'));
  try {
    const sourceVideo = path.join(root, 'source.mp4');
    const sourceVoice = path.join(root, 'voice.wav');
    const sourceSubtitle = path.join(root, 'subtitle.srt');
    const sourceMusic = path.join(root, 'music.wav');
    const sourceSfx = path.join(root, 'sfx.wav');
    await writeFile(sourceVideo, 'video-bytes');
    await writeFile(sourceVoice, 'voice-bytes');
    await writeFile(sourceSubtitle, '1\n00:00:00,000 --> 00:00:01,000\n台词\n');
    await writeFile(sourceMusic, 'music-bytes');
    await writeFile(sourceSfx, 'sfx-bytes');
    const jobs: ProductionJob[] = [
      succeededAsset('video-shot', 'VIDEO', sourceVideo, 'video/mp4'),
      {
        id: 'tts-shot',
        type: 'TTS',
        status: 'SUCCEEDED',
        dependencies: [],
        attempt: 1,
        maxAttempts: 1,
        output: {
          voiceAssets: [
            { assetUri: pathToFileURL(sourceVoice).href, mimeType: 'audio/wav' },
          ],
        },
      },
      succeededAsset('subtitle-shot', 'SUBTITLE', sourceSubtitle, 'application/x-subrip'),
      succeededAsset('music-scene', 'MUSIC', sourceMusic, 'audio/wav'),
      succeededAsset('sfx-shot', 'SFX', sourceSfx, 'audio/wav'),
      {
        id: 'render-shot',
        type: 'MEDIA_RENDER',
        status: 'PENDING',
        dependencies: ['video-shot', 'tts-shot', 'subtitle-shot', 'music-scene', 'sfx-shot'],
        attempt: 0,
        maxAttempts: 1,
      },
      {
        id: 'qa-scene',
        type: 'QA',
        status: 'PENDING',
        dependencies: ['render-shot'],
        attempt: 0,
        maxAttempts: 1,
      },
    ];
    const plan: ProductionPlan = {
      projectId: 'project-test',
      storyVersion: 1,
      productionVersion: 1,
      graph: new JobGraph(jobs),
      summary: Object.fromEntries(types.map((type) => [type, 0])) as Record<
        ProductionJobType,
        number
      >,
    };
    let mixed = false;
    const fakeMedia = {
      async mux(options: { videoPath: string; outputPath: string }) {
        await copyFile(options.videoPath, options.outputPath);
        return {};
      },
      async burnSubtitles(options: { inputPath: string; outputPath: string }) {
        await copyFile(options.inputPath, options.outputPath);
        return {};
      },
      async concat() {
        throw new Error('concat should not run for one voice line');
      },
      async mixAudio(options: { inputPaths: string[]; outputPath: string }) {
        mixed = true;
        await copyFile(options.inputPaths[0]!, options.outputPath);
        return {};
      },
    } as unknown as MediaPipeline;
    const storage = new LocalStorageProvider({ rootDirectory: path.join(root, 'assets') });
    const handlers = createFinalizationHandlers(plan, {
      media: fakeMedia,
      storage,
      workDirectory: path.join(root, 'work'),
    });
    const orchestrator = new ProductionOrchestrator(plan, handlers);
    const settled = await orchestrator.runUntilSettled(2);

    assert.equal(settled.completed, 7);
    assert.equal(mixed, true);
    assert.equal(plan.graph.get('qa-scene').output?.valid, true);
    assert.match(String(plan.graph.get('render-shot').output?.assetUri), /^file:/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function succeededAsset(
  id: string,
  type: ProductionJobType,
  filename: string,
  mimeType: string,
): ProductionJob {
  return {
    id,
    type,
    status: 'SUCCEEDED',
    dependencies: [],
    attempt: 1,
    maxAttempts: 1,
    output: {
      assetId: id,
      assetUri: pathToFileURL(filename).href,
      mimeType,
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
    },
  };
}

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
