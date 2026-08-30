import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyStateMutation } from '@filmgame/resolution-engine';
import type { RuntimeEvent, RuntimeGameState, StoryModel } from '@filmgame/shared-types';

import {
  createInitialState,
  createRoleKnowledgeView,
  FileRuntimeEventStore,
  hashRuntimeState,
  replayRuntimeEvents,
} from '../src/runtime.js';

test('file event store persists snapshots and hash-verified replay', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-runtime-events-'));
  const store = new FileRuntimeEventStore(root);
  const initial: RuntimeGameState = {
    sceneId: 'scene-one', phase: 'LOBBY', variables: { score: 0 }, relationships: {},
    evidenceByRole: { 'role-a': [] }, inventoryByRole: { 'role-a': [] }, revealedSecrets: [],
    historySequence: 0, submittedActions: {},
  };
  let state = structuredClone(initial);
  const events: RuntimeEvent[] = [];
  const push = (type: string, payload: RuntimeEvent['payload'], mutate: () => void) => {
    const before = hashRuntimeState(state); mutate();
    events.push({ sequence: events.length + 1, eventId: `event-${events.length + 1}`, roomId: 'room-replay', occurredAt: '2026-08-31T00:00:00.000Z', type, payload, stateBeforeHash: before, stateAfterHash: hashRuntimeState(state) });
  };
  push('PHASE_CHANGED', { phase: 'PLAYING' }, () => { state.phase = 'PLAYING'; });
  push('STATE_MUTATED', { operation: 'INCREMENT', path: 'variables.score', value: 2 }, () => { state = applyStateMutation(state, { operation: 'INCREMENT', path: 'variables.score', value: 2 }); });
  push('SCENE_CHANGED', { sceneId: 'scene-two' }, () => { state.sceneId = 'scene-two'; state.phase = 'PLAYING'; });
  state.historySequence = events.length;
  try {
    await store.append('room-replay', events);
    await store.saveSnapshot('room-replay', state);
    assert.equal((await store.loadEvents('room-replay')).length, 3);
    assert.deepEqual(await store.loadSnapshot('room-replay'), state);
    assert.deepEqual(replayRuntimeEvents(initial, events), state);
    const tampered = structuredClone(events);
    tampered[1]!.stateAfterHash = '0'.repeat(64);
    assert.throws(() => replayRuntimeEvents(initial, tampered), /hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bot knowledge projection cannot expose another role private information', async () => {
  const story = JSON.parse(
    await readFile(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
  ) as StoryModel;
  const state = createInitialState(story);
  state.phase = 'PLAYING';
  const roleA = story.characters[0]!.id;
  const roleB = story.characters[1]!.id;
  const scene = story.scenes.find((candidate) => candidate.id === state.sceneId)!;
  scene.privateInformationByRole[roleB] = ['ROLE_B_ONLY_MARKER'];
  const view = createRoleKnowledgeView(story, state, roleA);
  assert.equal(JSON.stringify(view).includes('ROLE_B_ONLY_MARKER'), false);
  assert.equal('state' in view, false);
  assert.deepEqual(view.availableActionIds, (scene.availableActionsByRole[roleA] ?? []).map((action) => action.id));
});
