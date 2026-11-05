import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComicService } from '../src/comic-service.js';
import { importComicCandidate } from '../src/comic-import.js';
import { billingSummary } from '../src/comic-cost-ledger.js';
import { submissionGate } from '../src/comic-harness.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';

test('historical imports require SHA and human adoption, reuse idempotently and never debit the new wallet', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-import-'));
  const source = path.join(root, 'source.mp4'); await writeFile(source, 'fixture-media');
  const expectedSha256 = createHash('sha256').update('fixture-media').digest('hex');
  const media = new MediaPipeline({ ffmpegPath: 'unused', ffprobePath: 'unused' });
  media.validateTechnical = async () => ({ valid: true, issues: [], durationSeconds: 4, probe: {} });
  const service = new ComicService({ root, llm: null, video: null, dreamina: null, media });
  try {
    let p = await service.create({ idea: 'Import a previously generated village scene.', style: 'film', ratio: '16:9', episodeCount: 1, episodeSeconds: 15 });
    p = await service.apply(p.id, { title: 'Village', logline: 'Morning', visualStyle: 'film', characters: [{ id: 'hero', name: 'Hero', appearance: 'coat', voice: 'silent' }], episodes: [{ id: 'e1', title: 'Morning', synopsis: 'Arrival', shots: [{ id: 's1', scene: 'Village', description: 'Arrival', camera: 'Wide', durationSeconds: 4, characterIds: ['hero'], dialogue: [] }] }] }, p.revision);
    const input = { projectId: p.id, shotId: 's1', source, expectedSha256, sourceLabel: 'prior node', historicalLedger: 'original-cost-ledger', provider: 'dreamina' as const };
    await assert.rejects(importComicCandidate(service, { ...input, expectedSha256: '0'.repeat(64) }), /SHA/);
    p = await importComicCandidate(service, input);
    assert.equal(p.runs.length, 1); assert.equal(p.runs[0]!.status, 'REVIEW');
    assert.equal(p.runs[0]!.reviewDecision, undefined);
    assert.equal((await readFile(source, 'utf8')), 'fixture-media');
    assert.equal(billingSummary(p, 'DREAMINA_CREDIT').committed, 0);
    assert.equal(billingSummary(p, 'DREAMINA_CREDIT').unknownReservations, 0);
    assert.deepEqual(submissionGate(p, { ...p.runs[0]!, id: 'new', status: 'QUOTED' }), []);
    p = await importComicCandidate(service, input); assert.equal(p.runs.length, 1);
    await assert.rejects(service.reviewedManifest(p.id), /采纳/);
    await service.approve(p.id, p.runs[0]!.id, expectedSha256);
    assert.equal((await service.reviewedManifest(p.id)).assets.length, 1);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('filmgame-import-'));
    await rm(root, { recursive: true, force: true });
  }
});
