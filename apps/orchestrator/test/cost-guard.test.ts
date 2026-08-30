import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { StoryModel } from '@filmgame/shared-types';

import { createProductionPlan, estimateProductionCost } from '../src/index.js';

test('cost estimate includes retry reserve before generation starts', async () => {
  const story = JSON.parse(await readFile(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8')) as StoryModel;
  const scene = story.scenes[0]!;
  const plan = createProductionPlan(story, 1, [{
    sceneId: scene.id,
    shots: [{
      id: 'golden-shot', sceneId: scene.id, characterIds: scene.rolesPresent.slice(0, 1),
      locationId: scene.locationId, description: 'test', dialogue: [{ characterId: scene.rolesPresent[0]!, text: 'hello' }],
      camera: 'locked', durationSeconds: 5, imagePrompt: 'image', videoPrompt: 'video',
    }],
  }]);
  const estimate = estimateProductionCost(plan, {
    currency: 'CNY', imageGeneration: 1, videoSecond: 2, ttsCharacter: 0.1,
    musicSecond: 0.2, sfxSecond: 0.3, mediaJob: 0.5,
  });
  assert.equal(estimate.videoSeconds, 5);
  assert.equal(estimate.ttsCharacters, 5);
  assert.ok(estimate.maximumAmount > estimate.baseAmount);
  assert.ok(estimate.retryReserveAmount > 0);
});
