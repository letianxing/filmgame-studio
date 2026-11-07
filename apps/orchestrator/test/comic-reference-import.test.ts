import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComicService } from '../src/comic-service.js';
import { importReferenceCandidate } from '../src/comic-reference-import.js';
import { billingSummary } from '../src/comic-cost-ledger.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';

test('external reference requires exact bytes, remains human-reviewed, and cannot satisfy video delivery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-reference-'));
  const media = new MediaPipeline({ ffmpegPath: 'unused', ffprobePath: 'unused' });
  media.probe = async () => ({ streams: [{ codec_type: 'video', width: 1920, height: 1080 }] });
  const service = new ComicService({ root, llm: null, video: null, dreamina: null, media });
  try {
    let p = await service.create({ idea: 'Village arrival in the morning.', style: 'film', ratio: '16:9', episodeCount: 1, episodeSeconds: 15 });
    p = await service.apply(p.id, { title: 'Village', logline: 'Morning', visualStyle: 'film', characters: [{ id: 'hero', name: 'Hero', appearance: 'coat', voice: 'silent' }], episodes: [{ id: 'e1', title: 'Morning', synopsis: 'Arrival', shots: [{ id: 's1', scene: 'Village', description: 'Arrival', camera: 'Wide', durationSeconds: 4, characterIds: [], dialogue: [] }] }] }, p.revision);
    const data = Buffer.from([137,80,78,71,13,10,26,10,1]);
    const input = { revision: p.revision, shotId: 's1', data, sha256: createHash('sha256').update(data).digest('hex'), sourceLabel: 'external keyframe', ledger: 'external receipt' };
    await assert.rejects(importReferenceCandidate(service, p.id, { ...input, sha256: '0'.repeat(64) }), /SHA/);
    await assert.rejects(importReferenceCandidate(service, p.id, { ...input, revision: -1 }));
    p = await importReferenceCandidate(service, p.id, input);
    assert.equal(p.runs[0]!.status, 'REVIEW');
    assert.equal(p.runs[0]!.reviewDecision, undefined);
    assert.equal(billingSummary(p, 'DREAMINA_CREDIT').committed, 0);
    p = await importReferenceCandidate(service, p.id, { ...input, revision: p.revision });
    assert.equal(p.runs.length, 1);
    await service.approve(p.id, p.runs[0]!.id, input.sha256);
    await assert.rejects(service.reviewedManifest(p.id));
    p = await service.get(p.id);
    await writeFile(path.join(service.directory(p.id), p.runs[0]!.file!), 'corrupt');
    await assert.rejects(importReferenceCandidate(service, p.id, { ...input, revision: p.revision }), /SHA/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('filmgame-reference-'));
    await rm(root, { recursive: true, force: true });
  }
});
