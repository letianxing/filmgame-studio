import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultHarnessPolicy, harnessProgress, submissionGate, validateHarnessPolicy } from '../src/comic-harness.js';
import type { ComicProject, ShotRun } from '../src/comic-service.js';

const now = Date.parse('2026-11-05T12:00:00Z');
function run(id: string, status: ShotRun['status'] = 'QUOTED'): ShotRun {
  return { id, shotId: 's1', provider: 'dreamina', status, storyVersion: 1, inputHash: 'input', createdAt: new Date(now - 60_000).toISOString(), creditCeiling: 10 };
}
function project(runs: ShotRun[]): ComicProject {
  return { id: 'p', title: '', idea: '', style: '', ratio: '16:9', episodeCount: 1, episodeSeconds: 20,
    revision: 1, storyVersion: 1, createdAt: '', updatedAt: '', phase: '', runs, references: {}, exports: [] };
}
test('unknown remote outcome blocks duplicate submission across changed input', () => {
  const old = { ...run('old', 'UNCERTAIN'), inputHash: 'old-input' };
  assert.match(submissionGate(project([old]), run('new'), now).join(''), /不确定/);
});
test('attempt boundary includes past failed versions but does not charge unsubmitted drafts', () => {
  const p = project([run('a', 'FAILED'), run('b', 'FAILED'), run('c', 'FAILED'), run('draft')]);
  assert.match(submissionGate(p, run('new'), now).join(''), /3 次/);
  p.harnessPolicy = { ...defaultHarnessPolicy, maxAttemptsPerShot: 4 };
  assert.deepEqual(submissionGate(p, run('new'), now), []);
});
test('elapsed boundary survives new run IDs; waiting never means failure or refund', () => {
  const old = { ...run('a', 'RUNNING'), submittedAt: new Date(now - 100 * 60_000).toISOString() };
  const p = project([old]);
  assert.match(submissionGate(p, run('b'), now).join(''), /耗时/);
  const view = harnessProgress(p, () => true, now);
  assert.equal(view.tasks[0]!.needsAttention, true);
  assert.equal(view.tasks[0]!.status, 'RUNNING');
  assert.equal(view.budget.committedCeiling, 10);
  assert.equal(view.budget.actualSettled, null);
});
test('review acknowledgment is revision specific and stale media never reaches review queue', () => {
  const r = { ...run('r', 'REVIEW'), sha256: 'v2', reviewAcknowledgedSha: 'v1' };
  assert.equal(harnessProgress(project([r]), () => true, now).review[0]!.acknowledged, false);
  assert.equal(harnessProgress(project([r]), () => false, now).review.length, 0);
  assert.equal(harnessProgress(project([r]), () => true, now).humanApprovedShots, 0);
});
test('non-finite and fractional policy cannot bypass boundaries', () => {
  assert.throws(() => validateHarnessPolicy({ ...defaultHarnessPolicy, maxAttemptsPerShot: NaN }));
  assert.throws(() => validateHarnessPolicy({ ...defaultHarnessPolicy, maxElapsedMinutesPerShot: 0.5 }));
});
