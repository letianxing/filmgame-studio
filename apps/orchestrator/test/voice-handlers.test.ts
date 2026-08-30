import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { JobGraph } from '@filmgame/job-engine';
import type {
  GeneratedAsset,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  TTSProvider,
  TTSRequest,
} from '@filmgame/provider-sdk';
import type { ProductionJob, ProductionJobType, StoryModel } from '@filmgame/shared-types';
import { LocalStorageProvider } from '@filmgame/storage-service';

import {
  createVoiceAssetHandlers,
  ProductionOrchestrator,
  type ProductionPlan,
} from '../src/index.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

class FixtureTtsProvider implements TTSProvider {
  readonly id = 'fixture-tts';
  readonly kind = 'TTS' as const;
  voiceId: string | undefined;
  health(): Promise<ProviderHealth> {
    return Promise.resolve({ status: 'HEALTHY', checkedAt: new Date().toISOString() });
  }
  synthesize(
    request: TTSRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    this.voiceId = request.voiceId;
    const now = new Date().toISOString();
    return Promise.resolve({
      data: { temporaryUri: 'data:audio/wav;base64,UklGRg==', mimeType: 'audio/wav' },
      provider: this.id,
      requestId: context.requestId,
      startedAt: now,
      completedAt: now,
      metadata: {},
    });
  }
}

test('voice and subtitle handlers preserve character voice binding and emit deterministic SRT', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-voice-assets-'));
  const tts = new FixtureTtsProvider();
  try {
    const configuredStory = structuredClone(story);
    const character = configuredStory.characters[0]!;
    character.voice.voiceId = 'approved-preset-voice';
    const dialogue = [{ characterId: character.id, text: '档案室的门刚刚被打开过。' }];
    const jobs: ProductionJob[] = [
      {
        id: 'tts-shot-1',
        type: 'TTS',
        status: 'READY',
        dependencies: [],
        attempt: 0,
        maxAttempts: 2,
        input: { dialogue, durationSeconds: 2 },
      },
      {
        id: 'subtitle-shot-1',
        type: 'SUBTITLE',
        status: 'PENDING',
        dependencies: ['tts-shot-1'],
        attempt: 0,
        maxAttempts: 2,
        input: { dialogue, durationSeconds: 2 },
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
    const storage = new LocalStorageProvider({ rootDirectory: root });
    const orchestrator = new ProductionOrchestrator(
      plan,
      createVoiceAssetHandlers(plan, configuredStory, { tts, storage }),
    );

    await orchestrator.runReady();
    await orchestrator.runReady();
    assert.equal(tts.voiceId, 'approved-preset-voice');
    const subtitleOutput = plan.graph.get('subtitle-shot-1').output;
    assert(subtitleOutput && typeof subtitleOutput.assetUri === 'string');
    const subtitle = await readFile(fileURLToPath(subtitleOutput.assetUri), 'utf8');
    assert.match(subtitle, /00:00:00,000 --> 00:00:02,000/u);
    assert.match(subtitle, /档案室/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
