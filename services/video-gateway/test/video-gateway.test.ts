import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RemoteVideoProvider } from '@filmgame/remote-video-adapter';
import { createArkVideoGatewayServer } from '../src/index.js';

test('RemoteVideoProvider reaches Ark through authenticated idempotent gateway', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'filmgame-video-gateway-'));
  let submits = 0;
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ark-secret');
    if (url.includes('page_num=1')) return Response.json({ items: [] });
    if (init?.method === 'POST') {
      submits += 1;
      const body = JSON.parse(String(init.body)) as { model: string; content: Array<{ type: string; role?: string }>; duration: number; ratio: string; generate_audio: boolean; resolution: string };
      assert.equal(body.model, 'doubao-seedance-production-id');
      assert.equal(body.duration, 8);
      assert.equal(body.ratio, '9:16');
      assert.equal(body.generate_audio, false);
      assert.equal(body.resolution, '1080p');
      assert.ok(body.content.some((item) => item.type === 'video_url' && item.role === 'reference_video'));
      assert.ok(body.content.some((item) => item.type === 'audio_url' && item.role === 'reference_audio'));
      assert.ok(body.content.length >= 1);
      return Response.json({ id: 'cgt-upstream-1' }, { status: 200 });
    }
    assert.match(url, /cgt-upstream-1$/u);
    return Response.json({
      id: 'cgt-upstream-1', status: 'succeeded', duration: '8',
      content: { video_url: 'https://assets.example.test/shot.mp4' },
      usage: { completion_tokens: 123 },
    });
  };
  const server = createArkVideoGatewayServer({
    arkBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    arkApiKey: 'ark-secret',
    arkVideoModel: 'doubao-seedance-production-id',
    internalToken: 'gateway-secret',
    publicModel: 'seedance-production',
    stateFile: path.join(temporary, 'state.json'),
  }, { fetch: upstreamFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const provider = new RemoteVideoProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    model: 'seedance-production', token: 'gateway-secret', pollIntervalMs: 1, timeoutMs: 1_000,
  });
  try {
    const context = { requestId: 'req-1', projectId: 'project-1', storyVersion: 1, productionVersion: 1, idempotencyKey: 'idem-1' };
    const request = { prompt: 'A detective enters', durationSeconds: 8, referenceAssetUris: [], aspectRatio: '9:16' as const, generateAudio: false,
      resolution: '1080p' as const, referenceVideoUris: ['https://example.test/reference.mp4'], referenceAudioUris: ['https://example.test/voice.wav'] };
    const first = await provider.generateVideo(request, context);
    const second = await provider.generateVideo(request, context);
    assert.equal(first.data.temporaryUri, 'https://assets.example.test/shot.mp4');
    assert.equal(first.data.durationSeconds, 8);
    assert.equal(second.data.temporaryUri, first.data.temporaryUri);
    assert.equal(submits, 1);
    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(unauthorized.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});
