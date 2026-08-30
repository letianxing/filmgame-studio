import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RemoteMusicProvider, RemoteSfxProvider } from '@filmgame/remote-audio-adapter';
import { createElevenLabsAudioGatewayServer } from '../src/index.js';

test('remote music and SFX adapters use ElevenLabs gateway and signed assets', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'filmgame-audio-gateway-'));
  const calls: Array<{ url: string; body?: unknown }> = [];
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get('xi-api-key'), 'eleven-secret');
    if (url.endsWith('/models')) return Response.json({ models: [] });
    const body = JSON.parse(String(init?.body)); calls.push({ url, body });
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'request-id': `upstream-${calls.length}` } });
  };
  const gatewayConfig = {
    baseUrl: 'https://api.elevenlabs.io/v1', apiKey: 'eleven-secret', musicModel: 'music_v2',
    sfxModel: 'eleven_text_to_sound_v2', internalToken: 'audio-token', assetSigningSecret: 'asset-signing-secret',
    publicBaseUrl: 'http://127.0.0.1:1', assetRoot: path.join(temporary, 'assets'), stateFile: path.join(temporary, 'state.json'),
  };
  const server = createElevenLabsAudioGatewayServer(gatewayConfig, { fetch: upstreamFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  gatewayConfig.publicBaseUrl = baseUrl;
  try {
    const config = { baseUrl, token: 'audio-token', musicModel: 'music_v2', sfxModel: 'eleven_text_to_sound_v2', pollIntervalMs: 2, timeoutMs: 2_000 };
    const context = { requestId: 'req-audio', projectId: 'project-1', storyVersion: 1, productionVersion: 1, idempotencyKey: 'music-idem' };
    const music = await new RemoteMusicProvider(config).generateMusic({ prompt: 'cold suspense', durationSeconds: 10, seamlessLoop: false }, context);
    const bytes = new Uint8Array(await (await fetch(music.data.temporaryUri)).arrayBuffer());
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    const sfx = await new RemoteSfxProvider(config).generateSfx({ prompt: 'door slam', durationSeconds: 2 }, { ...context, idempotencyKey: 'sfx-idem' });
    assert.equal(sfx.data.mimeType, 'audio/mpeg');
    assert.match(calls[0]?.url ?? '', /\/music\?/u);
    assert.match(calls[1]?.url ?? '', /\/sound-generation\?/u);
    assert.equal((calls[0]?.body as { model_id?: string }).model_id, 'music_v2');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});
