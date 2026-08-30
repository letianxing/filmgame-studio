import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { RuntimeGameState, StoryModel, SubmittedAction } from '@filmgame/shared-types';

import { ResolutionError, resolveScene } from '../src/index.js';

const samplePath = new URL('../../../examples/snowbound-hotel/story.json', import.meta.url);

function fixture(): { story: StoryModel; state: RuntimeGameState } {
  const story = JSON.parse(readFileSync(samplePath, 'utf8')) as StoryModel;
  return {
    story,
    state: {
      sceneId: 'scene-lobby',
      phase: 'PLAYING',
      variables: {
        'evidence-published': false,
        'killer-contained': false,
        'second-death': false,
        'old-case-exposed': false,
      },
      relationships: {},
      evidenceByRole: { journalist: ['evidence-photo'] },
      inventoryByRole: { owner: ['item-master-key'], brother: ['item-recorder'] },
      revealedSecrets: [],
      historySequence: 0,
    },
  };
}

test('server resolves an authorized action and commits deterministic mutations', () => {
  const { story, state } = fixture();
  const action: SubmittedAction = {
    roleId: 'journalist',
    actionId: 'action-journalist-publish',
    targetId: 'evidence-photo',
    submittedAt: '2026-08-30T05:10:00.000Z',
  };
  const result = resolveScene({
    roomId: 'room-001',
    scene: story.scenes[0]!,
    state,
    actions: [action],
    now: '2026-08-30T05:10:01.000Z',
  });

  assert.equal(result.matchedRuleId, 'rule-lobby-publish');
  assert.equal(result.state.sceneId, 'scene-archive');
  assert.equal(result.state.variables['evidence-published'], true);
  assert.equal(state.variables['evidence-published'], false);
  assert.ok(result.events.some((event) => event.type === 'SCENE_CHANGED'));
});

test('client cannot submit an action owned by another role', () => {
  const { story, state } = fixture();
  assert.throws(
    () =>
      resolveScene({
        roomId: 'room-001',
        scene: story.scenes[0]!,
        state,
        actions: [
          {
            roleId: 'actor',
            actionId: 'action-detective-search',
            submittedAt: '2026-08-30T05:10:00.000Z',
          },
        ],
        now: '2026-08-30T05:10:01.000Z',
      }),
    (error: unknown) => error instanceof ResolutionError && error.code === 'ACTION_NOT_AUTHORIZED',
  );
});

test('highest-priority matching ending wins without an LLM decision', () => {
  const { story, state } = fixture();
  state.sceneId = 'scene-archive';
  const result = resolveScene({
    roomId: 'room-001',
    scene: story.scenes[1]!,
    state,
    actions: [
      {
        roleId: 'journalist',
        actionId: 'action-journalist-broadcast',
        submittedAt: '2026-08-30T05:20:00.000Z',
      },
      {
        roleId: 'detective',
        actionId: 'action-detective-arrest',
        targetId: 'owner',
        submittedAt: '2026-08-30T05:20:00.000Z',
      },
    ],
    now: '2026-08-30T05:20:01.000Z',
  });
  assert.equal(result.state.endingId, 'ending-truth');
  assert.equal(result.state.phase, 'ENDING');
});
