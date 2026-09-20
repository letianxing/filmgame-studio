import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
    // Generation is fire-and-forget, so closing the server does not stop background
    // writes into `temporary`; removing the directory under them fails with ENOTEMPTY.
    await server.whenIdle();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('whenIdle waits for a generation that is still writing after the server closes', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'filmgame-audio-idle-'));
  // Hold the upstream response open so the generation is guaranteed to still be running
  // when the server closes; without whenIdle the asset write lands after teardown.
  const upstreamFetch: typeof fetch = async (input) => {
    if (String(input).endsWith('/models')) return Response.json({ models: [] });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return new Response(new Uint8Array([9, 9, 9, 9]), {
      status: 200, headers: { 'content-type': 'audio/mpeg', 'request-id': 'upstream-idle' },
    });
  };
  const assetRoot = path.join(temporary, 'assets');
  const stateFile = path.join(temporary, 'state.json');
  const server = createElevenLabsAudioGatewayServer({
    baseUrl: 'https://api.elevenlabs.io/v1', apiKey: 'eleven-secret', musicModel: 'music_v2',
    sfxModel: 'eleven_text_to_sound_v2', internalToken: 'audio-token',
    assetSigningSecret: 'asset-signing-secret', publicBaseUrl: 'http://127.0.0.1:1',
    assetRoot, stateFile,
  }, { fetch: upstreamFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const submitted = await fetch(`http://127.0.0.1:${port}/v1/audio/generations`, {
      method: 'POST',
      headers: { authorization: 'Bearer audio-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'SFX', model: 'eleven_text_to_sound_v2',
        request: { prompt: 'door slam', durationSeconds: 2 },
        context: { idempotencyKey: 'idle-idem' },
      }),
    });
    assert.equal(submitted.status, 202);
    const { generationId } = await submitted.json() as { generationId: string };

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await server.whenIdle();

    const state = JSON.parse(await readFile(stateFile, 'utf8')) as Array<{ generationId: string; status: string; filename?: string; sizeBytes?: number }>;
    const task = state.find((entry) => entry.generationId === generationId);
    assert.equal(task?.status, 'SUCCEEDED', 'generation must be finished once whenIdle resolves');
    assert.equal(task?.sizeBytes, 4);
    assert.equal((await stat(task!.filename!)).size, 4, 'the asset must be fully on disk');
  } finally {
    await server.whenIdle();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('concurrent generations all persist their final status', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'filmgame-audio-concurrent-'));
  const upstreamFetch: typeof fetch = async (input) => {
    if (String(input).endsWith('/models')) return Response.json({ models: [] });
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200, headers: { 'content-type': 'audio/mpeg' },
    });
  };
  const stateFile = path.join(temporary, 'state.json');
  const server = createElevenLabsAudioGatewayServer({
    baseUrl: 'https://api.elevenlabs.io/v1', apiKey: 'eleven-secret', musicModel: 'music_v2',
    sfxModel: 'eleven_text_to_sound_v2', internalToken: 'audio-token',
    assetSigningSecret: 'asset-signing-secret', publicBaseUrl: 'http://127.0.0.1:1',
    assetRoot: path.join(temporary, 'assets'), stateFile,
  }, { fetch: upstreamFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const total = 25;
  try {
    // Unserialised saves shared one temp path: the writers truncated each other and the
    // losing rename failed with ENOENT, dropping status updates (and, before generations
    // were tracked, crashing the process with an unhandled rejection).
    const responses = await Promise.all(Array.from({ length: total }, (_, index) =>
      fetch(`http://127.0.0.1:${port}/v1/audio/generations`, {
        method: 'POST',
        headers: { authorization: 'Bearer audio-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'SFX', model: 'eleven_text_to_sound_v2',
          request: { prompt: `sfx ${index}`, durationSeconds: 2 },
          context: { idempotencyKey: `concurrent-${index}` },
        }),
      })));
    assert.deepEqual([...new Set(responses.map((one) => one.status))], [202]);

    await server.whenIdle();
    const tasks = JSON.parse(await readFile(stateFile, 'utf8')) as Array<{ status: string }>;
    assert.equal(tasks.length, total, 'every submission must survive in the state file');
    assert.equal(
      tasks.filter((task) => task.status === 'SUCCEEDED').length, total,
      'every generation must record its final status',
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await server.whenIdle();
    await rm(temporary, { recursive: true, force: true });
  }
});
