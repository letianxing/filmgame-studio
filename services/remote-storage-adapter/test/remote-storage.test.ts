import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

import { RemoteStorageProvider } from '../src/index.js';

test('remote storage streams bytes and validates the immutable receipt', async () => {
  const bytes = new TextEncoder().encode('remote-asset');
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const received = Buffer.concat(chunks);
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        uri: 'https://assets.invalid/project/shot.bin',
        sha256: createHash('sha256').update(received).digest('hex'),
        sizeBytes: received.byteLength,
        contentType: request.headers['content-type'],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const provider = new RemoteStorageProvider({
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    const result = await provider.put(
      'project/shot.bin',
      bytes,
      'application/octet-stream',
      {
        requestId: 'storage-test',
        projectId: 'project-test',
        storyVersion: 1,
        idempotencyKey: 'storage-test',
      },
    );
    assert.equal(result.data.sizeBytes, bytes.byteLength);
    await assert.rejects(
      provider.put('../escape', bytes, 'application/octet-stream', {
        requestId: 'unsafe',
        projectId: 'project-test',
        storyVersion: 1,
        idempotencyKey: 'unsafe',
      }),
      /Unsafe storage key/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
