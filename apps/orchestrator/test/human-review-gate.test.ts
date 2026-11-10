import assert from 'node:assert/strict';
import test from 'node:test';
import { JobGraph } from '../../../packages/job-engine/src/index.js';
import { ProductionOrchestrator, type ProductionPlan } from '../src/index.js';
import type { ProductionJob } from '../../../packages/shared-types/src/index.js';

function plan(): ProductionPlan {
  const jobs: ProductionJob[] = [
    { id: 'concept', type: 'IMAGE', status: 'PENDING', dependencies: [], attempt: 0, maxAttempts: 3, inputHash: 'identity-v1' },
    { id: 'video', type: 'VIDEO', status: 'PENDING', dependencies: ['concept'], attempt: 0, maxAttempts: 3 },
  ];
  return { projectId: 'p', storyVersion: 1, productionVersion: 1, graph: new JobGraph(jobs), summary: {} as ProductionPlan['summary'] };
}

test('generic production stops downstream at exact-output human review and survives recovery', async () => {
  const p = plan(); let videoCalls = 0;
  const orchestrator = new ProductionOrchestrator(p, {
    IMAGE: { run: async () => ({ sha256: 'image-v1', uri: 'fixture:image-v1' }) },
    VIDEO: { run: async () => { videoCalls++; return { sha256: 'video-v1' }; } },
  }, { requireHumanReview: true });
  assert.equal((await orchestrator.runUntilSettled()).awaitingReview, 1);
  assert.equal(videoCalls, 0);
  p.graph = new JobGraph(p.graph.list(), { recoverRunning: true });
  assert.equal(p.graph.get('concept').status, 'WAITING');
  assert.throws(() => p.graph.decideHumanReview('concept', 'wrong', true, 'reviewed'));
  p.graph.decideHumanReview('concept', p.graph.get('concept').humanReview!.digest, true, 'identity accepted');
  assert.equal((await orchestrator.runUntilSettled()).awaitingReview, 1);
  assert.equal(videoCalls, 1);
  p.graph.decideHumanReview('video', p.graph.get('video').humanReview!.digest, false, 'contact incorrect');
  await orchestrator.runUntilSettled();
  assert.equal(videoCalls, 1);
  assert.equal(p.graph.get('video').status, 'FAILED');
});

test('guarded generic provider errors pause instead of auto-retrying a possibly charged call', async () => {
  const p = plan(); let calls = 0;
  const orchestrator = new ProductionOrchestrator(p, { IMAGE: { run: async () => { calls++; throw new Error('unknown remote outcome'); } } },
    { requireHumanReview: true, budget: { currency: 'CNY', maxAmount: 10 }, estimateCost: () => 2 });
  const result = await orchestrator.runUntilSettled();
  assert.equal(calls, 1);
  assert.equal(result.paused, 1);
  assert.equal(p.graph.get('concept').status, 'PAUSED');
});
