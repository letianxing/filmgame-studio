import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { RemoteMusicProvider } from '../src/index.js';

test('remote audio provider follows the stable generation contract', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/audio/generations' && request.method === 'POST') {
      response.end(JSON.stringify({ generationId: 'audio-1' }));
      return;
    }
    if (request.url === '/v1/audio/generations/audio-1') {
      response.end(
        JSON.stringify({
          status: 'SUCCEEDED',
          asset: { temporaryUri: 'https://assets.invalid/music.wav', mimeType: 'audio/wav' },
        }),
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
    const provider = new RemoteMusicProvider({
      baseUrl: `http://127.0.0.1:${address.port}`,
      musicModel: 'music-v1',
      sfxModel: 'sfx-v1',
      pollIntervalMs: 1,
    });
    const result = await provider.generateMusic(
      { prompt: 'cold mystery score', durationSeconds: 8, seamlessLoop: false },
      {
        requestId: 'music-test',
        projectId: 'project-test',
        storyVersion: 1,
        productionVersion: 1,
        idempotencyKey: 'music-test',
      },
    );
    assert.equal(result.data.mimeType, 'audio/wav');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
