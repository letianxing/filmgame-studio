import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { StoryModel } from '@filmgame/shared-types';

import { buildRuntimePackage } from '../src/index.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

test('runtime packager emits deterministic authoritative data for every client target', () => {
  const first = buildRuntimePackage(story, {
    runtimeVersion: 1,
    assetManifestUri: 'asset-manifest.json',
    videoAssetIdByEntityId: { 'scene-lobby': 'final-scene-lobby' },
  });
  const second = buildRuntimePackage(story, {
    runtimeVersion: 1,
    assetManifestUri: 'asset-manifest.json',
    videoAssetIdByEntityId: { 'scene-lobby': 'final-scene-lobby' },
  });

  assert.equal(first.sha256, second.sha256);
  assert.equal(first.runtime.initialSceneId, 'scene-lobby');
  const scenes = first.runtime.scenes as Array<Record<string, unknown>>;
  assert.equal(scenes[0]?.videoAssetId, 'final-scene-lobby');
  assert.equal((first.runtime.roles as unknown[]).length, story.brief.playerCount);
});
