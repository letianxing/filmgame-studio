import assert from 'node:assert/strict';
import test from 'node:test';

import { JobGraph } from '@filmgame/job-engine';
import type { ProductionJob, ProductionJobType } from '@filmgame/shared-types';

import {
  InMemoryProductionAuditSink,
  ProductionOrchestrator,
  type JobHandler,
  type ProductionPlan,
} from '../src/index.js';

test('local generative GPU work is serialized even when global concurrency is high', async () => {
  let active = 0;
  let maximumActive = 0;
  const handler: JobHandler = {
    async run() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {};
    },
  };
  const jobs: ProductionJob[] = ['image-a', 'image-b', 'video-a'].map((id, index) => ({
    id,
    type: index === 2 ? 'VIDEO' : 'IMAGE',
    status: 'READY',
    dependencies: [],
    attempt: 0,
    maxAttempts: 1,
  }));
  const plan: ProductionPlan = {
    projectId: 'scheduler-test',
    storyVersion: 1,
    productionVersion: 1,
    graph: new JobGraph(jobs),
    summary: Object.fromEntries(types.map((type) => [type, 0])) as Record<
      ProductionJobType,
      number
    >,
  };
  const audit = new InMemoryProductionAuditSink();
  const orchestrator = new ProductionOrchestrator(
    plan,
    { IMAGE: handler, VIDEO: handler },
    { auditSink: audit },
  );
  const settled = await orchestrator.runUntilSettled(8);

  assert.equal(maximumActive, 1);
  assert.equal(audit.list().filter((event) => event.status === 'SUCCEEDED').length, 3);
  assert.deepEqual(settled, { completed: 3, failed: 0, blocked: 0, cancelled: 0, total: 3 });
});

const types: ProductionJobType[] = [
  'DIRECTOR_BREAKDOWN',
  'STORYBOARD',
  'IMAGE',
  'VIDEO',
  'TTS',
  'SUBTITLE',
  'MUSIC',
  'SFX',
  'MEDIA_RENDER',
  'QA',
  'PACKAGE',
];
