import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { AssetLock, StoryModel } from '@filmgame/shared-types';

import { buildCanonicalBible, transitionAssetLock, validateContinuity } from '../src/index.js';

async function fixture(): Promise<StoryModel> {
  return JSON.parse(await readFile(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8')) as StoryModel;
}

test('legacy story deterministically projects one canonical bible', async () => {
  const story = await fixture();
  const first = buildCanonicalBible(story);
  const second = buildCanonicalBible(story);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.characters.length, story.characters.length);
  assert.equal(first.costumes.length, story.characters.length);
  assert.equal(first.voices.length, story.characters.length);
});

test('asset lock lifecycle requires review and canonical references', () => {
  let lock: AssetLock = { status: 'DRAFT', revision: 1, referenceAssetIds: [], constraints: [] };
  lock = transitionAssetLock(lock, 'REVIEW');
  lock = transitionAssetLock(lock, 'APPROVED');
  assert.throws(() => transitionAssetLock(lock, 'LOCKED'), /canonical reference/i);
  lock.referenceAssetIds = ['character-reference'];
  const locked = transitionAssetLock(lock, 'LOCKED', { at: '2026-08-31T00:00:00.000Z' });
  assert.equal(locked.status, 'LOCKED');
  assert.throws(() => transitionAssetLock(locked, 'DEPRECATED'), /override reason/i);
});

test('story contradiction validation catches conflicting mutation and closed loop', async () => {
  const story = await fixture();
  const scene = story.scenes[0]!;
  scene.resolutionRules[0]!.mutations = [
    { operation: 'SET', path: 'variables.evidence-published', value: true },
    { operation: 'SET', path: 'variables.evidence-published', value: false },
  ];
  scene.nextSceneCandidates = [scene.id];
  scene.resolutionRules[0]!.nextSceneId = scene.id;
  delete scene.resolutionRules[0]!.endingId;
  const report = validateContinuity(story);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((finding) => finding.code === 'CONFLICTING_STATE_MUTATION'));
  assert.ok(report.issues.some((finding) => finding.code === 'STORY_INFINITE_LOOP'));
});

test('continuity validator catches private leakage, impossible ownership and missing locked references', async () => {
  const story = await fixture();
  const scene = story.scenes[0]!;
  const absentRole = story.characters.find((character) => !scene.rolesPresent.includes(character.id))?.id;
  if (absentRole) scene.privateInformationByRole[absentRole] = ['should not be delivered'];
  const item = story.inventory[0]!;
  item.transferable = false;
  story.characters[0]!.startingInventoryIds = [item.id];
  story.characters[1]!.startingInventoryIds = [item.id];
  story.characters[0]!.assetLock = { status: 'LOCKED', revision: 1, referenceAssetIds: [], constraints: [] };
  story.canonicalBible = buildCanonicalBible(story);
  const report = validateContinuity(story);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((finding) => finding.code === 'CHARACTER_REFERENCE_MISSING'));
  assert.ok(report.issues.some((finding) => finding.code === 'PROP_OWNERSHIP_CONTRADICTION'));
  if (absentRole) assert.ok(report.issues.some((finding) => finding.code === 'INFORMATION_LEAK_BOUNDARY'));
});
