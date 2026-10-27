import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sample from '../../../examples/screenwriting/sample-content.json' with { type: 'json' };
import { validateScreenplay, reviseScreenplay, type ScreenplayContent } from '../src/screenplay.js';
import { FileScreenplayStore } from '../../../apps/orchestrator/src/screenplay-store.js';

test('screenplay schema checks references and scene order without forcing a long-film template', () => {
  validateScreenplay(sample);
  const bad = structuredClone(sample); bad.scenes[0]!.dialogue[0]!.characterId = 'invented';
  assert.throws(() => validateScreenplay(bad), /speaker/);
  const order = structuredClone(sample); order.scenes[1]!.order = 1;
  assert.throws(() => validateScreenplay(order), /order/);
  assert.throws(() => validateScreenplay({ ...sample, apiKey: 'not-allowed' }), /schema/);
});

test('revision protects locked ending, explicit scope and server-owned version', () => {
  const initial = { schemaVersion: '1.0.0' as const, projectId: 'sample', version: 1, parentVersion: null,
    createdAt: new Date().toISOString(), changeReason: 'initial', content: structuredClone(sample) as ScreenplayContent };
  const content = structuredClone(initial.content); content.scenes[0]!.dialogue[0]!.text = '行李我自己拿。';
  const next = reviseScreenplay(initial, content, { expectedVersion: 1, reason: '对白精修', scope: 'dialogue', sceneIds: ['station'] });
  assert.equal(next.version, 2); assert.equal(next.parentVersion, 1);
  assert.equal(initial.content.scenes[0]!.dialogue[0]!.text, '我下个月就回来。');
  content.scenes[0]!.action = '姐姐撕掉车票。';
  assert.throws(() => reviseScreenplay(initial, content, { expectedVersion: 1, reason: '对白', scope: 'dialogue', sceneIds: ['station'] }), /SCOPE_CONFLICT/);
  const ending = structuredClone(initial.content); ending.ending = '姐姐也上车。';
  assert.throws(() => reviseScreenplay(initial, ending, { expectedVersion: 1, reason: '改稿' }), /LOCK_CONFLICT/);
  assert.throws(() => reviseScreenplay(initial, initial.content, { expectedVersion: 0, reason: 'stale' }), /VERSION_CONFLICT/);
});

test('immutable store survives reopening and rejects concurrent stale commits and traversal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'filmgame-screenplay-'));
  try {
    const store = new FileScreenplayStore(directory);
    await store.commit('sample', sample, { expectedVersion: 0, reason: '建立虚构测试项目' });
    const results = await Promise.allSettled([
      store.commit('sample', sample, { expectedVersion: 1, reason: '并发稿一' }),
      store.commit('sample', sample, { expectedVersion: 1, reason: '并发稿二' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const reopened = new FileScreenplayStore(directory); assert.equal((await reopened.latest('sample'))!.version, 2);
    assert.equal((await reopened.get('sample', 1))!.content.ending, sample.ending);
    await assert.rejects(() => reopened.latest('../outside'), /project ID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
