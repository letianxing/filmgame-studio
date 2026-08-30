import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { LiveKitSpeechIntentAdapter } from '../src/index.js';

test('speech adapter returns a candidate and has no authoritative mutation field', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        intentType: 'lie',
        targetRoleId: 'detective',
        topic: 'alibi',
        emotion: 'nervous',
        confidence: 0.93,
        transcript: '警官，我昨晚一直在酒店。',
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const adapter = new LiveKitSpeechIntentAdapter({
      bridgeBaseUrl: `http://127.0.0.1:${address.port}`,
    });
    const candidate = await adapter.parseUtterance(
      {
        roomId: 'room-1',
        sceneId: 'scene-lobby',
        roleId: 'journalist',
        transcript: '警官，我昨晚一直在酒店。',
        language: 'zh-CN',
      },
      {
        requestId: 'speech-test',
        projectId: 'project-test',
        storyVersion: 1,
        idempotencyKey: 'speech-test',
      },
    );
    assert.equal(candidate.intentType, 'lie');
    assert.equal('stateMutations' in candidate, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
