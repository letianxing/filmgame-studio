import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { RemoteVideoProvider } from '../src/index.js';

test('gateway rejection details are actionable and redact internal token and URLs', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Image rejected. Token secret-token, source https://example.test/private?signature=123' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  try {
    const provider = new RemoteVideoProvider({ baseUrl: `http://127.0.0.1:${address.port}`, model: 'test', token: 'secret-token' });
    await assert.rejects(() => provider.generateVideo({ prompt: 'test', durationSeconds: 4, referenceAssetUris: [] },
      { projectId: 'p', storyVersion: 1, requestId: 'r', idempotencyKey: 'k' }), (error: unknown) => {
        assert(error instanceof Error); assert.match(error.message, /Image rejected/);
        assert.ok(!error.message.includes('secret-token')); assert.ok(!error.message.includes('signature=123')); return true;
      });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('remote video provider submits and polls the stable first-party contract', async () => {
  let polls = 0;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/video/generations' && request.method === 'POST') {
      response.end(JSON.stringify({ generationId: 'generation-1' }));
      return;
    }
    if (request.url === '/v1/video/generations/generation-1') {
      polls += 1;
      response.end(
        JSON.stringify(
          polls === 1
            ? { status: 'RUNNING' }
            : {
                status: 'SUCCEEDED',
                asset: { temporaryUri: 'https://assets.invalid/shot.mp4', mimeType: 'video/mp4' },
                providerMetadata: { upstream: 'fixture' },
              },
        ),
      );
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const provider = new RemoteVideoProvider({
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: 'fixture-video-v1',
      pollIntervalMs: 1,
    });
    const result = await provider.generateVideo(
      { prompt: 'snow hotel', durationSeconds: 2, referenceAssetUris: [] },
      {
        requestId: 'remote-video-test',
        projectId: 'project-test',
        storyVersion: 1,
        productionVersion: 1,
        idempotencyKey: 'remote-video-test',
      },
    );
    assert.equal(result.data.mimeType, 'video/mp4');
    assert.equal(result.metadata.upstream, 'fixture');
    assert.equal(polls, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
