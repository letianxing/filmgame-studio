import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { MediaPipeline } from '@filmgame/media-pipeline';
import type {
  GeneratedAsset,
  ImageProvider,
  MusicProvider,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  SFXProvider,
  StorageProvider,
  TTSProvider,
  VideoProvider,
} from '@filmgame/provider-sdk';
import type { StoryModel } from '@filmgame/shared-types';
import { LocalStorageProvider } from '@filmgame/storage-service';

import {
  createAudioAssetHandlers,
  createFinalizationHandlers,
  createMediaAssetHandlers,
  createProductionPlan,
  createVoiceAssetHandlers,
  InMemoryProductionAuditSink,
  ProductionOrchestrator,
  type SceneBreakdown,
} from '../src/index.js';
import { readFileSync } from 'node:fs';

const sourceStory = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

test('the complete 104-job production DAG can settle and package every ending', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-full-production-'));
  try {
    const story = structuredClone(sourceStory);
    for (const character of story.characters) character.voice.voiceId = `voice-${character.id}`;
    const breakdowns: SceneBreakdown[] = [
      ...story.scenes.map((scene) => unit(scene.id, scene.rolesPresent, scene.locationId, 'SCENE', 2)),
      ...story.endings.map((ending) =>
        unit(ending.id, Object.keys(ending.characterResults), story.locations[0]!.id, 'ENDING'),
      ),
    ];
    const plan = createProductionPlan(story, 1, breakdowns);
    const storage: StorageProvider = new LocalStorageProvider({
      rootDirectory: path.join(root, 'assets'),
    });
    const image = provider('IMAGE', 'image/png', 'data:image/png;base64,AQID') as ImageProvider;
    const video = provider('VIDEO', 'video/mp4', 'data:video/mp4;base64,AQID') as VideoProvider;
    const tts = provider('TTS', 'audio/wav', 'data:audio/wav;base64,AQID') as TTSProvider;
    const music = provider('MUSIC', 'audio/wav', 'data:audio/wav;base64,AQID') as MusicProvider;
    const sfx = provider('SFX', 'audio/wav', 'data:audio/wav;base64,AQID') as SFXProvider;
    const media = {
      async mux(options: { videoPath: string; outputPath: string }) {
        await copyFile(options.videoPath, options.outputPath);
        return {};
      },
      async burnSubtitles(options: { inputPath: string; outputPath: string }) {
        await copyFile(options.inputPath, options.outputPath);
        return {};
      },
      async mixAudio(options: { inputPaths: string[]; outputPath: string }) {
        await copyFile(options.inputPaths[0]!, options.outputPath);
        return {};
      },
      async concat(options: { concatListPath: string; outputPath: string }) {
        const firstPart = path.join(path.dirname(options.concatListPath), 'part-001.mp4');
        await copyFile(firstPart, options.outputPath);
        return {};
      },
    } as unknown as MediaPipeline;
    const audit = new InMemoryProductionAuditSink();
    const handlers = {
      ...createMediaAssetHandlers(plan, { image, video, storage }),
      ...createVoiceAssetHandlers(plan, story, { tts, storage }),
      ...createAudioAssetHandlers(plan, { music, sfx, storage }),
      ...createFinalizationHandlers(plan, {
        media,
        storage,
        workDirectory: path.join(root, 'work'),
        story,
        productionAssetsCommerciallyApproved: true,
        autoApproveQaAssets: true,
      }),
    };
    const orchestrator = new ProductionOrchestrator(plan, handlers, { auditSink: audit });
    const settled = await orchestrator.runUntilSettled(32);

    assert.equal(settled.failed, 0);
    assert.equal(settled.blocked, 0);
    assert.equal(settled.completed, settled.total);
    const packageOutput = plan.graph.get('runtime-package').output!;
    assert.equal(packageOutput.publishReady, true);
    assert.deepEqual(packageOutput.missingEndingIds, []);
    assert.equal(
      audit.list().filter((event) => event.status === 'SUCCEEDED').length,
      settled.total,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function unit(
  id: string,
  roleIds: string[],
  locationId: string,
  entityType: 'SCENE' | 'ENDING',
  shotCount = 1,
): SceneBreakdown {
  return {
    sceneId: id,
    entityType,
    shots: Array.from({ length: shotCount }, (_, index) => ({
        id: `shot-${id}-${index + 1}`,
        sceneId: id,
        characterIds: roleIds,
        locationId,
        description: `Production unit ${id}`,
        dialogue: [{ characterId: roleIds[0]!, text: `Dialogue for ${id}` }],
        camera: 'locked wide',
        durationSeconds: 1,
        imagePrompt: `image ${id}`,
        videoPrompt: `video ${id}`,
      })),
  };
}

function provider(kind: string, mimeType: string, temporaryUri: string): unknown {
  const health = (): Promise<ProviderHealth> =>
    Promise.resolve({ status: 'HEALTHY', checkedAt: new Date().toISOString() });
  const generate = (_request: unknown, context: ProviderContext): Promise<ProviderResult<GeneratedAsset>> => {
    const now = new Date().toISOString();
    return Promise.resolve({
      data: { temporaryUri, mimeType },
      provider: `fixture-${kind.toLowerCase()}`,
      requestId: context.requestId,
      startedAt: now,
      completedAt: now,
      usage: [{ unit: 'REQUESTS', input: 1, output: 1, currency: 'USD', estimatedCost: 0 }],
      metadata: {},
    });
  };
  return {
    id: `fixture-${kind.toLowerCase()}`,
    kind,
    health,
    generateImage: generate,
    generateVideo: generate,
    synthesize: generate,
    generateMusic: generate,
    generateSfx: generate,
  };
}
