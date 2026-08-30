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
  assert.equal(graph.fail('video', 'temporary').status, 'RETRYING');
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

test('interrupted jobs recover as retrying without losing completed outputs', () => {
  const graph = new JobGraph(
    [
      { id: 'image', type: 'IMAGE', status: 'SUCCEEDED', dependencies: [], attempt: 1, maxAttempts: 2, output: { assetId: 'image-asset' } },
      { id: 'video', type: 'VIDEO', status: 'RUNNING', dependencies: ['image'], attempt: 1, maxAttempts: 3, progress: 0.6 },
    ],
    { recoverRunning: true, now: '2026-08-31T00:00:00.000Z' },
  );
  assert.equal(graph.get('image').status, 'SUCCEEDED');
  assert.equal(graph.get('image').output?.assetId, 'image-asset');
  assert.equal(graph.get('video').status, 'RETRYING');
  assert.equal(graph.ready()[0]?.id, 'video');
  assert.equal(graph.start('video').attempt, 2);
});

test('job heartbeat, pause and stale transitions remain reversible', () => {
  const graph = new JobGraph([
    { id: 'image', type: 'IMAGE', status: 'READY', dependencies: [], attempt: 0, maxAttempts: 2 },
  ]);
  graph.start('image');
  assert.equal(graph.heartbeat('image', 0.4, '2026-08-31T00:00:00.000Z').progress, 0.4);
  graph.fail('image', 'temporary');
  assert.equal(graph.get('image').status, 'RETRYING');
  graph.pause('image', 'budget');
  assert.equal(graph.get('image').status, 'PAUSED');
  graph.resume('image');
  assert.equal(graph.get('image').status, 'READY');
  graph.markStale('image');
  assert.equal(graph.get('image').status, 'STALE');
  assert.equal(graph.ready()[0]?.status, 'READY');
});
