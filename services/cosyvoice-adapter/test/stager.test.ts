import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LocalTemporaryAssetStager } from '../src/index.js';

test('local TTS stager is path-safe and idempotent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-tts-stage-'));
  try {
    const stager = new LocalTemporaryAssetStager(root);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const options = {
      contentType: 'audio/wav',
      extension: 'wav',
      requestId: '../../shot:line-1',
    };
    const uri = await stager.put(bytes, options);
    assert.equal(path.dirname(fileURLToPath(uri)), root);
    assert.deepEqual(await readFile(fileURLToPath(uri)), Buffer.from(bytes));
    assert.equal(await stager.put(bytes, options), uri);
    await assert.rejects(stager.put(new Uint8Array([9]), options), /collision/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
