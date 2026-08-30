import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductionJob } from '@filmgame/shared-types';

import { JobGraph } from '../src/index.js';

function job(id: string, dependencies: string[], maxAttempts = 2): ProductionJob {
  return {
    id,
    type: 'IMAGE',
    status: dependencies.length ? 'PENDING' : 'READY',
    dependencies,
    attempt: 0,
    maxAttempts,
  };
}

test('job graph releases work only after dependencies succeed', () => {
  const graph = new JobGraph([job('reference', []), job('shot', ['reference'])]);
  assert.deepEqual(graph.ready().map((candidate) => candidate.id), ['reference']);
  graph.start('reference');
  graph.succeed('reference', { assetId: 'asset-reference' });
  assert.deepEqual(graph.ready().map((candidate) => candidate.id), ['shot']);
});

test('job graph retries then blocks descendants after terminal failure', () => {
  const graph = new JobGraph([job('video', [], 2), job('render', ['video'])]);
  graph.start('video');
  assert.equal(graph.fail('video', 'temporary').status, 'READY');
  graph.start('video');
  assert.equal(graph.fail('video', 'terminal').status, 'FAILED');
  assert.equal(graph.get('render').status, 'BLOCKED');
});

test('job graph rejects dependency cycles', () => {
  assert.throws(
    () => new JobGraph([job('a-job', ['b-job']), job('b-job', ['a-job'])]),
    /cycle/i,
  );
});
