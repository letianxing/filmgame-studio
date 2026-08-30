import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { StoryModel } from '@filmgame/shared-types';

import { analyzeMultiplayerBalance, runDeterministicBotPlaytest } from '../src/index.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

test('bot playtest explores authorized deterministic paths without an LLM state owner', () => {
  const report = runDeterministicBotPlaytest(story, { maxTransitions: 128 });
  assert(report.transitionsEvaluated > 0);
  assert(Object.keys(report.sceneVisits).length > 0);
  assert(Object.values(report.actionsByRole).some((count) => count > 0));
  assert(report.errors.every((error) => !error.message.includes('not authorized')));
  assert.equal(Object.keys(report.balance.metricsByRole).length, story.characters.length);
});

test('balance validator reports a role with no actions or private information', () => {
  const copy = structuredClone(story);
  const roleId = copy.characters[0]!.id;
  for (const scene of copy.scenes) {
    scene.availableActionsByRole[roleId] = [];
    scene.privateInformationByRole[roleId] = [];
  }
  const report = analyzeMultiplayerBalance(copy);
  assert.ok(report.warnings.some((warning) => warning.roleId === roleId && warning.code === 'PASSIVE_ROLE'));
  assert.ok(report.warnings.some((warning) => warning.roleId === roleId && warning.code === 'INFORMATION_STARVATION'));
});
