import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { StoryModel } from '@filmgame/shared-types';

import {
  BuiltInIntentInterpreter,
  InMemoryStoryVersionStore,
  VersionConflictError,
  applyPatch,
  applyProposal,
  proposeChange,
  validateStory,
} from '../src/index.js';

const samplePath = new URL('../../../examples/snowbound-hotel/story.json', import.meta.url);

function loadStory(): StoryModel {
  return JSON.parse(readFileSync(samplePath, 'utf8')) as StoryModel;
}

test('sample story passes semantic validation', () => {
  const validation = validateStory(loadStory());
  assert.equal(validation.valid, true, JSON.stringify(validation.issues, null, 2));
  assert.equal(validation.reachableEndingIds?.length, 6);
});

test('natural-language character retype produces a versioned, selective proposal', async () => {
  const story = loadStory();
  const proposal = await proposeChange(
    story,
    {
      commandId: 'command-001',
      projectId: story.projectId,
      baseStoryVersion: 1,
      text: '把心理学家改成医生。',
    },
    new BuiltInIntentInterpreter(),
  );

  assert.equal(proposal.status, 'READY');
  assert.equal(proposal.preview?.characters[2]?.publicProfile.role, '医生');
  assert.equal(story.characters[2]?.publicProfile.role, '心理学家');
  assert.ok(proposal.dependencyImpact.stages.includes('CHARACTER_REFERENCE'));
  assert.ok(proposal.dependencyImpact.stages.includes('RUNTIME_PACKAGE'));
  assert.equal(proposal.preview?.storyVersion, 2);
});

test('locked character change is never silently applied', async () => {
  const story = loadStory();
  story.characters[2]!.assetLock!.status = 'LOCKED';
  const proposal = await proposeChange(story, {
    commandId: 'command-002',
    projectId: story.projectId,
    baseStoryVersion: 1,
    text: '把心理学家改成医生。',
  });

  assert.equal(proposal.status, 'LOCK_CONFLICT');
  assert.equal(proposal.dependencyImpact.lockedAssetConflicts[0]?.entityId, 'psychologist');
  assert.throws(() => applyProposal(story, proposal), /not ready/i);
});

test('version store enforces optimistic concurrency', async () => {
  const story = loadStory();
  const store = new InMemoryStoryVersionStore();
  store.seed(story);
  const proposal = await proposeChange(story, {
    commandId: 'command-003',
    projectId: story.projectId,
    baseStoryVersion: 1,
    text: '把心理学家改成医生。',
  });
  const record = applyProposal(story, proposal);
  store.append(record);
  assert.equal(store.latest(story.projectId)?.version, 2);
  assert.throws(() => store.append(record), VersionConflictError);
});

test('patcher blocks prototype-pollution paths', () => {
  assert.throws(
    () => applyPatch(loadStory(), [{ op: 'add', path: '/__proto__/polluted', value: true }]),
    /unsafe patch key/i,
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test('creator commands cannot patch server-controlled metadata or versions', () => {
  const story = loadStory();
  assert.throws(
    () => applyPatch(story, [{ op: 'replace', path: '/storyVersion', value: 999 }]),
    /controlled by the server/i,
  );
  assert.throws(
    () => applyPatch(story, [{ op: 'add', path: '/metadata/providerConfig', value: { apiKey: 'attacker' } }]),
    /controlled by the server/i,
  );
});

test('black coat command targets one character and previews selective regeneration', async () => {
  const story = loadStory();
  story.characters[0]!.name = '女主';
  const proposal = await proposeChange(
    story,
    {
      commandId: 'command-black-coat',
      projectId: story.projectId,
      baseStoryVersion: story.storyVersion,
      text: '把女主外套改成黑色。',
    },
    new BuiltInIntentInterpreter(),
  );
  assert.equal(proposal.status, 'READY');
  assert.deepEqual(proposal.dependencyImpact.affectedEntityIds, [story.characters[0]!.id]);
  assert.equal(proposal.preview?.characters[0]?.visual.costume, '黑色外套');
  assert.ok(proposal.dependencyImpact.stages.includes('CHARACTER_REFERENCE'));
});
