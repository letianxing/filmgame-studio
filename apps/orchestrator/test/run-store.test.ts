import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JobGraph } from '@filmgame/job-engine';
import type { ProductionJobType, StoryModel } from '@filmgame/shared-types';

import { FileProductionRunStore } from '../src/run-store.js';
import { ProductionOrchestrator, type ProductionPlan } from '../src/index.js';

test('file run store atomically restores an interrupted job frontier', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-run-store-'));
  const store = new FileProductionRunStore(root);
  const story = JSON.parse(
    await readFile(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
  ) as StoryModel;
  try {
    await store.save({
      schemaVersion: '1.0.0', runId: 'run-recovery', projectId: story.projectId,
      storyVersion: story.storyVersion, productionVersion: 1, executionStatus: 'RUNNING',
      updatedAt: '2026-08-31T00:00:00.000Z', story, breakdowns: [], transitions: [],
      jobs: [
        { id: 'shot-001', type: 'IMAGE', status: 'SUCCEEDED', dependencies: [], attempt: 1, maxAttempts: 2, output: { assetId: 'asset-001' } },
        { id: 'shot-300', type: 'VIDEO', status: 'RUNNING', dependencies: ['shot-001'], attempt: 1, maxAttempts: 3 },
      ],
    });
    const restored = await store.load('run-recovery');
    assert.ok(restored);
    const graph = new JobGraph(restored.jobs, { recoverRunning: true });
    assert.equal(graph.get('shot-001').output?.assetId, 'asset-001');
    assert.equal(graph.get('shot-300').status, 'RETRYING');
    assert.equal((await store.list()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('orchestrator crash recovery skips completed work and resumes the frontier', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-orchestrator-recovery-'));
  const store = new FileProductionRunStore(root);
  const story = JSON.parse(
    await readFile(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
  ) as StoryModel;
  const jobs = [
    { id: 'shot-001', type: 'IMAGE' as const, status: 'READY' as const, dependencies: [], attempt: 0, maxAttempts: 2 },
    { id: 'shot-300', type: 'VIDEO' as const, status: 'PENDING' as const, dependencies: ['shot-001'], attempt: 0, maxAttempts: 3 },
  ];
  const summary = Object.fromEntries(types.map((type) => [type, 0])) as Record<ProductionJobType, number>;
  const plan: ProductionPlan = { projectId: story.projectId, storyVersion: 1, productionVersion: 1, graph: new JobGraph(jobs), summary };
  let firstCalls = 0;
  try {
    const first = new ProductionOrchestrator(
      plan,
      { IMAGE: { async run() { firstCalls += 1; return { assetId: 'asset-001' }; } } },
      { runStore: store, runId: 'run-crash', snapshotContext: { story, breakdowns: [] } },
    );
    await first.runReady(1);
    assert.equal(firstCalls, 1);
    const snapshot = await store.load('run-crash');
    assert.ok(snapshot);
    const restoredPlan: ProductionPlan = {
      projectId: story.projectId, storyVersion: 1, productionVersion: 1,
      graph: new JobGraph(snapshot.jobs, { recoverRunning: true }), summary,
    };
    let repeatedImageCalls = 0;
    let videoCalls = 0;
    const resumed = new ProductionOrchestrator(
      restoredPlan,
      {
        IMAGE: { async run() { repeatedImageCalls += 1; return {}; } },
        VIDEO: { async run() { videoCalls += 1; return { assetId: 'asset-300' }; } },
      },
      { runStore: store, runId: 'run-crash', snapshotContext: { story, breakdowns: [] } },
    );
    const settled = await resumed.runUntilSettled(1);
    assert.equal(repeatedImageCalls, 0);
    assert.equal(videoCalls, 1);
    assert.equal(settled.completed, 2);
    assert.equal((await store.load('run-crash'))?.executionStatus, 'SUCCEEDED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const types: ProductionJobType[] = [
  'DIRECTOR_BREAKDOWN', 'STORYBOARD', 'IMAGE', 'VIDEO', 'TTS', 'SUBTITLE',
  'MUSIC', 'SFX', 'MEDIA_RENDER', 'QA', 'PACKAGE',
];
