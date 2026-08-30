import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductionJob } from '@filmgame/shared-types';

import { previewProductionInvalidation } from '../src/index.js';

test('changing one character invalidates only its branch and shared package', () => {
  const jobs: ProductionJob[] = [
    { id: 'character-a', entityId: 'character-a', type: 'IMAGE', status: 'SUCCEEDED', dependencies: [], attempt: 1, maxAttempts: 2, input: { characterId: 'character-a' } },
    { id: 'character-b', entityId: 'character-b', type: 'IMAGE', status: 'SUCCEEDED', dependencies: [], attempt: 1, maxAttempts: 2, input: { characterId: 'character-b' } },
    { id: 'shot-a', entityId: 'shot-a', type: 'VIDEO', status: 'SUCCEEDED', dependencies: ['character-a'], attempt: 1, maxAttempts: 2, input: { characterIds: ['character-a'] } },
    { id: 'shot-b', entityId: 'shot-b', type: 'VIDEO', status: 'SUCCEEDED', dependencies: ['character-b'], attempt: 1, maxAttempts: 2, input: { characterIds: ['character-b'] } },
    { id: 'runtime-package', type: 'PACKAGE', status: 'SUCCEEDED', dependencies: ['shot-a', 'shot-b'], attempt: 1, maxAttempts: 1, input: {} },
  ];
  const result = previewProductionInvalidation(jobs, ['character-a']);
  assert.ok(result.regenerationNodeIds.includes('character-a'));
  assert.ok(result.regenerationNodeIds.includes('shot-a'));
  assert.ok(result.regenerationNodeIds.includes('runtime-package'));
  assert.equal(result.regenerationNodeIds.includes('character-b'), false);
  assert.equal(result.regenerationNodeIds.includes('shot-b'), false);
});
