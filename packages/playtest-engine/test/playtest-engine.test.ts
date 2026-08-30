import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { StoryModel } from '@filmgame/shared-types';

import { runDeterministicBotPlaytest } from '../src/index.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

test('bot playtest explores authorized deterministic paths without an LLM state owner', () => {
  const report = runDeterministicBotPlaytest(story, { maxTransitions: 128 });
  assert(report.transitionsEvaluated > 0);
  assert(Object.keys(report.sceneVisits).length > 0);
  assert(Object.values(report.actionsByRole).some((count) => count > 0));
  assert(report.errors.every((error) => !error.message.includes('not authorized')));
});
