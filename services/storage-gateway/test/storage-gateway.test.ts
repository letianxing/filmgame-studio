import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RemoteStorageProvider } from '@filmgame/remote-storage-adapter';
import { createStorageGatewayServer, presignS3Get, type GatewayObjectStore, type StoredMetadata } from '../src/index.js';

class FakeStore implements GatewayObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; metadata: StoredMetadata }>();
  async health(): Promise<void> {}
  async head(key: string): Promise<StoredMetadata | null> { return this.objects.get(key)?.metadata ?? null; }
  async putFile(key: string, filename: string, metadata: StoredMetadata): Promise<void> { this.objects.set(key, { bytes: new Uint8Array(await readFile(filename)), metadata }); }
  async signedRead(key: string, expires: number): Promise<string> { assert.ok(this.objects.has(key)); return `https://assets.example.test/${key}?expires=${expires}`; }
  objectUri(key: string): string { return `s3://filmgame-production/${key}`; }
}

test('RemoteStorageProvider streams through authenticated immutable gateway', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'filmgame-storage-gateway-'));
  const store = new FakeStore();
  const server = createStorageGatewayServer({ internalToken: 'storage-token', stagingRoot: temporary }, store);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const provider = new RemoteStorageProvider({ baseUrl: `http://127.0.0.1:${address.port}`, token: 'storage-token' });
  try {
    const context = { requestId: 'req-store', projectId: 'project-1', storyVersion: 1, idempotencyKey: 'store-idem' };
    const stored = await provider.put('projects/p1/video.mp4', new Uint8Array([5, 6, 7]), 'video/mp4', context);
    assert.equal(stored.data.uri, 's3://filmgame-production/projects/p1/video.mp4');
    assert.equal(stored.data.sizeBytes, 3);
    assert.deepEqual([...(store.objects.get('projects/p1/video.mp4')?.bytes ?? [])], [5, 6, 7]);
    const signed = await provider.getSignedReadUri('projects/p1/video.mp4', 60);
    assert.match(signed, /^https:\/\/assets\.example\.test/u);
    const second = await provider.put('projects/p1/video.mp4', new Uint8Array([5, 6, 7]), 'video/mp4', context);
    assert.equal(second.data.sha256, stored.data.sha256);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});

test('R2/S3 presigned URL uses SigV4 query credentials', () => {
  const url = presignS3Get(new URL('https://account.r2.cloudflarestorage.com/bucket/a.mp4'), 600, {
    endpoint: 'https://account.r2.cloudflarestorage.com', region: 'auto', bucket: 'bucket',
    accessKeyId: 'access', secretAccessKey: 'secret',
  }, new Date('2026-08-30T12:00:00Z'));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(parsed.searchParams.get('X-Amz-Expires'), '600');
  assert.match(parsed.searchParams.get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/u);
});
