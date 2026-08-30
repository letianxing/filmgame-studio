import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalStorageProvider } from '../src/index.js';

const context = {
  requestId: 'storage-test',
  projectId: 'project-test',
  storyVersion: 1,
  idempotencyKey: 'storage-test-v1',
};

test('local storage writes an immutable, hashed asset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-storage-'));
  try {
    const provider = new LocalStorageProvider({ rootDirectory: root });
    const bytes = new TextEncoder().encode('filmgame-asset');
    const result = await provider.put('project/v1/shot.bin', bytes, 'application/octet-stream', context);
    assert.equal(result.data.sha256, '218821a2621928faf9b69008ec90ef3ee0b9601dcab120de792fc99914e79186');
    assert.deepEqual(await readFile(path.join(root, 'project', 'v1', 'shot.bin')), Buffer.from(bytes));
    const retry = await provider.put('project/v1/shot.bin', bytes, 'application/octet-stream', context);
    assert.equal(retry.data.sha256, result.data.sha256);
    await assert.rejects(
      provider.put(
        'project/v1/shot.bin',
        new TextEncoder().encode('different'),
        'application/octet-stream',
        context,
      ),
      /different content/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local storage rejects traversal keys before writing', async () => {
  const provider = new LocalStorageProvider({ rootDirectory: path.resolve(tmpdir(), 'filmgame-storage') });
  await assert.rejects(
    provider.put('../escape.bin', new Uint8Array([1]), 'application/octet-stream', context),
    /Unsafe storage key/,
  );
});
