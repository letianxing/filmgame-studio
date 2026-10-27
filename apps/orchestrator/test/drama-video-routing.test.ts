import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideoBackend, assertWanShots } from '../src/drama-video-routing.js';
import { sampleDrama } from '../../../packages/story-engine/test/drama.test.js';
test('video backend must be explicit; no cloud fallback for local requests', () => {
  assert.equal(parseVideoBackend('WAN'), 'WAN');
  assert.equal(parseVideoBackend('SEEDANCE'), 'SEEDANCE');
  for (const value of [undefined, null, '', 'auto', 'wan']) assert.throws(() => parseVideoBackend(value), /视频引擎/);
});
test('Wan requires a composed first frame and bounded shot length before providers run', () => {
  const doc = structuredClone(sampleDrama); doc.episodes[0]!.shots[0]!.durationSeconds = 2;
  assert.throws(() => assertWanShots(doc), /首帧/);
  doc.episodes[0]!.shots[0]!.firstFrameAssetId = `asset-${'a'.repeat(64)}`;
  assert.doesNotThrow(() => assertWanShots(doc));
  doc.episodes[0]!.shots[0]!.durationSeconds = 5;
  assert.throws(() => assertWanShots(doc), /4 秒/);
});

test('composition root selects Wan without cloud fallback and isolates cache identity', async () => {
  const { createDramaProviders } = await import('../src/drama-providers.js');
  const values: Record<string, string> = { WAN_RUNTIME: 'COMFYUI', COMFYUI_BASE_URL: 'http://127.0.0.1:8188', COMFYUI_LOCAL_VIDEO_ENABLED: 'true',
    COSYVOICE_BASE_URL: 'http://127.0.0.1:50000', FFMPEG_PATH: '/configured/ffmpeg', FFPROBE_PATH: '/configured/ffprobe',
    REMOTE_VIDEO_BASE_URL: 'http://127.0.0.1:4301', REMOTE_VIDEO_MODEL: 'seedance-production' };
  const old = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  try {
    const wan = createDramaProviders('/tmp/filmgame-test', 'WAN');
    const cloud = createDramaProviders('/tmp/filmgame-test', 'SEEDANCE');
    assert.equal(wan.video!.id, 'comfyui-video');
    assert.equal(cloud.video!.id, 'remote-video');
    assert.notEqual(wan.fingerprint, cloud.fingerprint);
    process.env.COMFYUI_LOCAL_VIDEO_ENABLED = 'false';
    assert.throws(() => createDramaProviders('/tmp/filmgame-test', 'WAN'), /不会自动切换云端/);
  } finally { for (const k of Object.keys(values)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
});
