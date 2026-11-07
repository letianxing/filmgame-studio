import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTextIntegrity } from '../src/comic-text-integrity.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComicService } from '../src/comic-service.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';

test('blocks lossy shell text in action and nested dialogue', () => {
  assert.throws(() => assertTextIntegrity({ description: '0??0.8????????' }), /description/);
  assert.throws(() => assertTextIntegrity({ dialogue: [{ text: '???' }] }), /dialogue\[0\].text/);
  assert.throws(() => assertTextIntegrity({ camera: '\uFFFD' }), /camera/);
});
test('preserves actual multilingual direction and normal questions', () => {
  assert.doesNotThrow(() => assertTextIntegrity({ description: '九名士卒，左四右五。', dialogue: [{ text: '你见过？ Why?' }] }));
});

test('prepare and quoted submission reject corrupt text before reaching provider', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-encoding-'));
  const service = new ComicService({ root, llm: null, video: null, dreamina: null,
    media: new MediaPipeline({ ffmpegPath: 'unused', ffprobePath: 'unused' }) });
  try {
    let p = await service.create({ idea: 'Village arrival in the morning.', style: 'film', ratio: '16:9', episodeCount: 1, episodeSeconds: 15 });
    p = await service.apply(p.id, { title: 'Village', logline: 'Morning', visualStyle: 'film', characters: [{ id: 'hero', name: 'Hero', appearance: 'coat', voice: 'silent' }], episodes: [{ id: 'e1', title: 'Morning', synopsis: 'Arrival', shots: [{ id: 's1', scene: 'Village', description: '?????', camera: 'Wide', durationSeconds: 4, characterIds: [], dialogue: [] }] }] }, p.revision);
    await assert.rejects(service.prepare(p.id, 's1', 'dreamina'), /Corrupted authoring text/);
    p = await service.get(p.id);
    assert.equal(p.runs.length, 0);
    p.runs.push({ id: 'old-quote', shotId: 's1', status: 'QUOTED', provider: 'dreamina', storyVersion: p.storyVersion, inputHash: service.hash(p, 's1'), createdAt: new Date().toISOString(), credits: 56 });
    await service.save(p);
    await assert.rejects(service.run(p.id, 'old-quote', 56), /Corrupted authoring text/);
    assert.equal((await service.get(p.id)).runs[0]!.status, 'QUOTED');
  } finally { await rm(root, { recursive: true, force: true }); }
});
