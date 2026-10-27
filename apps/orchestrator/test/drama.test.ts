import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { DramaDocument, JsonValue } from '@filmgame/shared-types';
import type { LLMProvider, ProviderResult, GeneratedAsset } from '@filmgame/provider-sdk';
import { dramaContent } from '@filmgame/story-engine';
import { MediaPipeline } from '@filmgame/media-pipeline';
import { DramaStore, type DramaRecord, type DramaRender } from '../src/drama-store.js';
import { DramaHttp } from '../src/drama-http.js';
import { proposeDrama } from '../src/drama-workflow.js';
import { renderDrama, formatSubtitles, type DramaRenderServices } from '../src/drama-renderer.js';

const document: DramaDocument = {
  schemaVersion: '1.0.0', projectId: 'drama-a', version: 1, parentVersion: null,
  title: '短片测试', visualStyle: 'watercolor', aspectRatio: '16:9',
  characters: [{ id: 'hero', name: '主角', appearance: 'blue coat', voiceId: 'test-voice',
    referenceImageAssetId: '', voiceReferenceAssetId: '', referenceTranscript: '', rightsConfirmed: true }],
  episodes: [{ id: 'episode-a', title: '第一集', shots: ['shot-a', 'shot-b'].map((id) => ({ id, description: 'opens a letter', camera: 'close-up',
    durationSeconds: 2, characterIds: ['hero'], dialogue: [{ characterId: 'hero', text: '你好。' }] })) }],
};
const record = (): DramaRecord => ({ id: 'drama-a', ownerId: 'owner-a', idea: '短片创作', createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), status: 'READY', document: structuredClone(document), history: [structuredClone(document)], assets: {}, renders: [] });
const result = <T>(data: T): ProviderResult<T> => ({ data, metadata: {}, provider: 'test', requestId: 'test', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });

test('LLM drafts cannot forge voice bindings or creator permission; revisions preserve approved bindings', async () => {
  const content = dramaContent(document);
  const llm = { id: 'test', kind: 'LLM', async generateStructured() { return result(content as unknown as JsonValue); } } as unknown as LLMProvider;
  const context = { projectId: 'drama-a', storyVersion: 1, requestId: 'r', idempotencyKey: 'k' };
  const generated = await proposeDrama(llm, { idea: '写一个故事', context });
  assert.equal(generated.characters[0]!.rightsConfirmed, false); assert.equal(generated.characters[0]!.voiceId, '');
  const revised = await proposeDrama(llm, { idea: '修改对白', context, current: document });
  assert.equal(revised.characters[0]!.voiceId, 'test-voice'); assert.equal(revised.characters[0]!.rightsConfirmed, true);
});

test('drama API isolates owners, validates saves and references, and retains immutable history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'drama-http-'));
  const store = new DramaStore(directory); await store.init(); await store.save(record());
  const api = new DramaHttp(store, null, () => { throw new Error('not configured'); });
  const server = createServer((req, res) => { void api.handle(req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/dramas`;
  const post = (body: unknown) => fetch(`${base}/drama-a`, { method: 'POST', headers: { 'x-filmgame-owner': 'owner-a' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/drama-a`)).status, 401);
    assert.equal((await fetch(`${base}/drama-a`, { headers: { 'x-filmgame-owner': 'owner-b' } })).status, 404);
    const forgedFrame = dramaContent(document); forgedFrame.episodes[0]!.shots[0]!.firstFrameAssetId = `asset-${'d'.repeat(64)}`;
    assert.equal((await post({ action: 'save', expectedVersion: 1, content: forgedFrame })).status, 400);
    assert.equal((await post({ action: 'render', expectedVersion: 1, mode: 'VIDEO', maxShots: 2 })).status, 400);
    const changed = dramaContent(document); changed.title = '新片名';
    assert.equal((await post({ action: 'save', expectedVersion: 1, content: changed })).status, 202);
    assert.equal(store.get('drama-a', 'owner-a').history[0]!.title, '短片测试');
    assert.equal((await post({ action: 'save', expectedVersion: 1, content: changed })).status, 409);
    changed.characters[0]!.referenceImageAssetId = `asset-${'a'.repeat(64)}`;
    assert.equal((await post({ action: 'save', expectedVersion: 2, content: changed })).status, 400);
    assert.equal((await post({ action: 'rollback', expectedVersion: 2, targetVersion: 1 })).status, 202);
    assert.equal(store.get('drama-a', 'owner-a').document!.version, 3);
    const upload = await fetch(`${base}/drama-a/assets`, { method: 'POST', headers: { 'x-filmgame-owner': 'owner-a' }, body: '<svg onload="alert(1)">' });
    assert.equal(upload.status, 400);
    const asset = await store.put(Buffer.from('12345678'), 'video/mp4');
    store.get('drama-a', 'owner-a').assets[asset.id] = asset; await store.save(store.get('drama-a', 'owner-a'));
    const bytes = await fetch(`${base}/drama-a/assets/${asset.id}`, { headers: { 'x-filmgame-owner': 'owner-a', range: 'bytes=2-4' } });
    assert.equal(bytes.status, 206); assert.equal(await bytes.text(), '345');
    const suffix = await fetch(`${base}/drama-a/assets/${asset.id}`, { headers: { 'x-filmgame-owner': 'owner-a', range: 'bytes=-2' } });
    assert.equal(suffix.status, 206); assert.equal(await suffix.text(), '78');
    const invalid = await fetch(`${base}/drama-a/assets/${asset.id}`, { headers: { 'x-filmgame-owner': 'owner-a', range: 'bytes=99-' } });
    assert.equal(invalid.status, 416);
    const recovered = new DramaStore(directory); await recovered.init(); assert.equal(recovered.get('drama-a', 'owner-a').document!.version, 3);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('interrupted runs recover as retryable failures, never false completion', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'drama-recover-'));
  try {
    const store = new DramaStore(directory); await store.init(); const r = record(); r.status = 'REVISING';
    r.renders.push({ id: 'run-one', version: 1, mode: 'VIDEO', status: 'RUNNING', completed: 1, total: 2, message: '', shots: {}, episodes: [] });
    await store.save(r); const recovered = new DramaStore(directory); await recovered.init();
    assert.equal(recovered.get(r.id, r.ownerId).status, 'FAILED');
    assert.equal(recovered.get(r.id, r.ownerId).renders[0]!.status, 'FAILED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('subtitles preserve timing and escape cue markup', () => {
  const vtt = formatSubtitles([{ start: 1.25, end: 62.5, text: '<b>你好</b>\n第二行' }], true);
  assert.match(vtt, /00:00:01.250 --> 00:01:02.500/); assert.ok(!vtt.includes('<b>'));
});

test('real FFmpeg produces a complete episode, extends dialogue and reuses unchanged shots', async (t) => {
  let ffmpeg: string; let ffprobe: string;
  try { ffmpeg = process.env.FFMPEG_PATH || execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    ffprobe = process.env.FFPROBE_PATH || execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim(); }
  catch { t.skip('FFmpeg is not installed'); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'drama-render-'));
  try {
    const store = new DramaStore(directory); await store.init(); const r = record();
    const media = new MediaPipeline({ ffmpegPath: ffmpeg, ffprobePath: ffprobe, defaultVideoCodec: 'mpeg4' });
    const visual = path.join(directory, 'visual.mp4'); const audio = path.join(directory, 'speech.wav');
    await media.createTestPattern({ outputPath: visual, durationSeconds: 2, width: 320, height: 180 });
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '24000', audio]);
    let videos = 0; let voices = 0;
    const services = { media, fingerprint: 'test', image: {}, video: { async generateVideo() { videos++; return result<GeneratedAsset>({ temporaryUri: pathToFileURL(visual).href, mimeType: 'video/mp4' }); } },
      tts: { async synthesize() { voices++; return result<GeneratedAsset>({ temporaryUri: pathToFileURL(audio).href, mimeType: 'audio/wav' }); } },
      music: { async generateMusic() { return result<GeneratedAsset>({ temporaryUri: pathToFileURL(audio).href, mimeType: 'audio/wav' }); } } } as unknown as DramaRenderServices;
    const makeRun = (id: string): DramaRender => ({ id, version: 1, mode: 'VIDEO', status: 'RUNNING', completed: 0, total: 2, message: '', shots: {}, episodes: [] });
    const first = makeRun('run-a'); first.musicPrompt = 'test background'; r.renders.push(first);
    await renderDrama(r, first, store, services, new AbortController().signal);
    assert.equal(first.status, 'COMPLETED'); assert.equal(videos, 2); assert.equal(voices, 2);
    assert.equal(r.generations?.length, 5);
    assert.ok(first.episodes[0]!.duration > 6); // 2-second visuals must not cut the 3-second voices.
    const probe = await media.probe(store.assetPath(first.episodes[0]!.video));
    assert.ok(probe.streams?.some((s) => s.codec_type === 'subtitle'));
    const vtt = await readFile(store.assetPath(first.episodes[0]!.subtitle), 'utf8'); assert.match(vtt, /WEBVTT/);
    r.document!.title = '只改标题'; const second = makeRun('run-b'); r.renders.push(second);
    await renderDrama(r, second, store, services, new AbortController().signal);
    assert.equal(second.status, 'COMPLETED'); assert.equal(videos, 2); assert.equal(voices, 2);
    await writeFile(path.join(directory, 'verification.txt'), 'All assets are synthetic test media, not AI generation evidence.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('LLM cannot invent shot bindings and changed composition clears the old first frame', async () => {
  const current = structuredClone(document);
  current.episodes[0]!.shots[0]!.firstFrameAssetId = `asset-${'b'.repeat(64)}`;
  const proposed = dramaContent(current);
  const llm = { id: 'test', kind: 'LLM', async generateStructured() { return result(proposed as unknown as JsonValue); } } as unknown as LLMProvider;
  const context = { projectId: 'drama-a', storyVersion: 1, requestId: 'r', idempotencyKey: 'k' };
  const fresh = await proposeDrama(llm, { idea: '写一个故事', context });
  assert.equal(fresh.episodes[0]!.shots[0]!.firstFrameAssetId, undefined);
  const unchanged = await proposeDrama(llm, { idea: '修改对白', context, current });
  assert.equal(unchanged.episodes[0]!.shots[0]!.firstFrameAssetId, current.episodes[0]!.shots[0]!.firstFrameAssetId);
  proposed.episodes[0]!.shots[0]!.camera = 'new composition';
  const changed = await proposeDrama(llm, { idea: '改变机位', context, current });
  assert.equal(changed.episodes[0]!.shots[0]!.firstFrameAssetId, undefined);
});
