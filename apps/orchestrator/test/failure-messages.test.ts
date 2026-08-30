import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderError } from '@filmgame/provider-sdk';

import { toCreatorFailure } from '../src/failure-messages.js';

test('technical failures are translated into creator actions', () => {
  const oom = toCreatorFailure(new Error('CUDA out of memory while allocating 5778432 bytes'), 'SC032_SH04');
  assert.equal(oom.code, 'GPU_MEMORY_EXHAUSTED');
  assert.ok(oom.actions.includes('RETRY_LOWER_QUALITY'));
  const quota = toCreatorFailure(new ProviderError('video', 'QUOTA', 'HTTP 429', true), 'SC001_SH01');
  assert.equal(quota.code, 'PROVIDER_QUOTA');
  assert.ok(quota.actions.includes('SWITCH_PROVIDER'));
});
