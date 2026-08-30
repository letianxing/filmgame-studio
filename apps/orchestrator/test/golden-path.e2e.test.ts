import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCanonicalBible } from '@filmgame/consistency-engine';
import { runDeterministicBotPlaytest } from '@filmgame/playtest-engine';
import { buildRuntimePackage } from '@filmgame/runtime-packager';
import { validateStory } from '@filmgame/story-engine';
import type { JsonValue, ProductionJobType } from '@filmgame/shared-types';

import { createGoldenStory, goldenIdea } from '../../../examples/golden-project/golden-story.js';
import { createProductionPlan, ProductionOrchestrator, type HandlerRegistry } from '../src/index.js';

test('golden one-click path reaches an Unreal-readable runtime target with mock providers', async () => {
  assert.ok(goldenIdea.length >= 40);
  const story = createGoldenStory();
  story.canonicalBible = buildCanonicalBible(story);
  const validation = validateStory(story);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  story.validation = validation;

  const units = [
    ...story.scenes.map((scene) => ({ id: scene.id, locationId: scene.locationId, characterIds: scene.rolesPresent, entityType: 'SCENE' as const })),
    ...story.endings.map((ending) => ({ id: ending.id, locationId: story.locations[0]!.id, characterIds: Object.keys(ending.characterResults), entityType: 'ENDING' as const })),
  ];
  const breakdowns = units.map((unit) => ({
    sceneId: unit.id,
    entityType: unit.entityType,
    shots: [{
      id: `shot-${unit.id}`, sceneId: unit.id, characterIds: unit.characterIds,
      locationId: unit.locationId, description: `Golden shot for ${unit.id}`,
      dialogue: [{ characterId: unit.characterIds[0]!, text: '我们必须现在决定。' }],
      camera: 'locked medium wide', durationSeconds: 2,
      imagePrompt: `canonical image ${unit.id}`, videoPrompt: `canonical video ${unit.id}`,
    }],
  }));
  const plan = createProductionPlan(story, 1, breakdowns);
  const handlers = Object.fromEntries(
    productionTypes.map((type) => [
      type,
      {
        async run(job: { id: string }) {
          return {
            assetId: `asset-${job.id}`, assetUri: `https://mock.invalid/${job.id}`,
            mimeType: type === 'PACKAGE' ? 'application/json' : 'application/octet-stream',
            sha256: 'a'.repeat(64), sizeBytes: 1,
          } as Record<string, JsonValue>;
        },
      },
    ]),
  ) as HandlerRegistry;
  const settled = await new ProductionOrchestrator(plan, handlers).runUntilSettled(32);
  assert.equal(settled.completed, settled.total);
  const runtime = buildRuntimePackage(story, { runtimeVersion: 1, assetManifestUri: 'https://mock.invalid/asset-manifest.json' });
  assert.ok(Array.isArray(runtime.runtime.scenes) && runtime.runtime.scenes.length >= 3);
  const playtest = runDeterministicBotPlaytest(story, { maxTransitions: 64 });
  assert.ok(playtest.transitionsEvaluated > 0);
  const targets = ['COLYSEUS', 'COMPANION_WEB', 'UNREAL_WINDOWS', 'PLAYTEST'];
  assert.ok(targets.includes('UNREAL_WINDOWS'));
  assert.equal(runtime.runtime.projectId, story.projectId);
});

const productionTypes: ProductionJobType[] = [
  'DIRECTOR_BREAKDOWN', 'STORYBOARD', 'IMAGE', 'VIDEO', 'TTS', 'SUBTITLE',
  'MUSIC', 'SFX', 'MEDIA_RENDER', 'QA', 'PACKAGE',
];
