import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

export interface ElevenLabsAudioGatewayConfig {
  baseUrl: string;
  apiKey: string;
  musicModel: string;
  sfxModel: string;
  internalToken: string;
  assetSigningSecret: string;
  publicBaseUrl: string;
  assetRoot: string;
  stateFile: string;
}

export interface AudioGatewayDependencies { fetch?: typeof fetch; now?: () => number; }

interface AudioRequest {
  kind?: 'MUSIC' | 'SFX';
  model?: string;
  request?: { prompt?: string; durationSeconds?: number; seamlessLoop?: boolean };
  context?: { idempotencyKey?: string };
}
interface AudioTask {
  generationId: string;
  idempotencyKey: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  kind: 'MUSIC' | 'SFX';
  durationSeconds: number;
  filename?: string;
  sizeBytes?: number;
  sha256?: string;
  contentType?: string;
  error?: string;
  upstreamRequestId?: string;
}

export function createElevenLabsAudioGatewayServer(
  config: ElevenLabsAudioGatewayConfig,
  dependencies: AudioGatewayDependencies = {},
): Server {
  validateConfig(config);
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const store = new AudioTaskStore(config.stateFile);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        requireBearer(request, config.internalToken);
        const upstream = await fetchImpl(`${trimSlash(config.baseUrl)}/models`, {
          headers: elevenHeaders(config), signal: AbortSignal.timeout(8_000),
        });
        return sendJson(response, upstream.ok ? 200 : 503, { status: upstream.ok ? 'HEALTHY' : 'DEGRADED', upstreamStatus: upstream.status, provider: 'elevenlabs' });
      }

      const assetMatch = /^\/v1\/audio\/assets\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'GET' && assetMatch?.[1]) {
        const id = decodeURIComponent(assetMatch[1]);
        verifyAssetSignature(id, url.searchParams, config.assetSigningSecret, now());
        await store.load();
        const task = store.byGeneration(id);
        if (!task?.filename || task.status !== 'SUCCEEDED') throw new HttpError(404, 'ASSET_NOT_FOUND');
        const details = await stat(task.filename);
        response.writeHead(200, {
          'content-type': task.contentType ?? 'audio/mpeg', 'content-length': String(details.size),
          'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff',
        });
        createReadStream(task.filename).pipe(response);
        return;
      }

      requireBearer(request, config.internalToken);
      if (request.method === 'POST' && url.pathname === '/v1/audio/generations') {
        const body = await readJson<AudioRequest>(request);
        const generation = validateGeneration(body, config);
        await store.load();
        const existing = store.byIdempotency(generation.idempotencyKey);
        if (existing) return sendJson(response, 200, { generationId: existing.generationId });
        const task: AudioTask = {
          generationId: randomUUID(), idempotencyKey: generation.idempotencyKey,
          status: 'QUEUED', kind: generation.kind, durationSeconds: generation.durationSeconds,
        };
        await store.add(task);
        void generateAudio(task, generation.prompt, generation.model, config, fetchImpl, store);
        return sendJson(response, 202, { generationId: task.generationId });
      }

      const statusMatch = /^\/v1\/audio\/generations\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'GET' && statusMatch?.[1]) {
        await store.load();
        const task = store.byGeneration(decodeURIComponent(statusMatch[1]));
        if (!task) return sendJson(response, 404, { error: 'GENERATION_NOT_FOUND' });
        if (task.status === 'SUCCEEDED' && task.filename && task.sizeBytes !== undefined) {
          const expires = Math.floor(now() / 1000) + 3600;
          const signature = signAsset(task.generationId, expires, config.assetSigningSecret);
          return sendJson(response, 200, {
            status: task.status,
            asset: {
              temporaryUri: `${trimSlash(config.publicBaseUrl)}/v1/audio/assets/${encodeURIComponent(task.generationId)}?expires=${expires}&signature=${signature}`,
              mimeType: task.contentType ?? 'audio/mpeg', sizeBytes: task.sizeBytes,
              durationSeconds: task.durationSeconds, sha256: task.sha256,
            },
            usage: [{ unit: 'SECONDS', input: 0, output: task.durationSeconds }],
            providerMetadata: { upstreamRequestId: task.upstreamRequestId ?? '' },
          });
        }
        return sendJson(response, 200, { status: task.status, ...(task.error ? { error: task.error } : {}) });
      }
      return sendJson(response, 404, { error: 'NOT_FOUND' });
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 500;
      return sendJson(response, status, { error: cause instanceof Error ? cause.message : 'Internal gateway error' });
    }
  });
}

async function generateAudio(
  task: AudioTask, prompt: string, model: string, config: ElevenLabsAudioGatewayConfig,
  fetchImpl: typeof fetch, store: AudioTaskStore,
): Promise<void> {
  try {
    task.status = 'RUNNING'; await store.update(task);
    const isMusic = task.kind === 'MUSIC';
    const endpoint = isMusic ? '/music?output_format=mp3_44100_128' : '/sound-generation?output_format=mp3_44100_128';
    const body = isMusic
      ? { prompt, music_length_ms: Math.round(task.durationSeconds * 1_000), model_id: model, force_instrumental: true, sign_with_c2pa: true }
      : { text: prompt, duration_seconds: Math.min(30, Math.max(0.5, task.durationSeconds)), model_id: model, loop: false };
    const upstream = await fetchImpl(`${trimSlash(config.baseUrl)}${endpoint}`, {
      method: 'POST', headers: { ...elevenHeaders(config), 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!upstream.ok) throw new Error(`ElevenLabs returned HTTP ${upstream.status}: ${(await upstream.text()).slice(0, 500)}`);
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (!bytes.byteLength) throw new Error('ElevenLabs returned an empty audio file');
    await mkdir(config.assetRoot, { recursive: true });
    const filename = path.join(config.assetRoot, `${task.generationId}.mp3`);
    const temporary = `${filename}.partial`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, filename);
    task.status = 'SUCCEEDED'; task.filename = filename; task.sizeBytes = bytes.byteLength;
    task.sha256 = createHash('sha256').update(bytes).digest('hex');
    task.contentType = upstream.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg';
    const upstreamRequestId = upstream.headers.get('request-id') ?? upstream.headers.get('song-id');
    if (upstreamRequestId) task.upstreamRequestId = upstreamRequestId;
    await store.update(task);
  } catch (cause) {
    task.status = 'FAILED'; task.error = cause instanceof Error ? cause.message : 'Audio generation failed';
    await store.update(task);
  }
}

function validateGeneration(body: AudioRequest, config: ElevenLabsAudioGatewayConfig) {
  if (body.kind !== 'MUSIC' && body.kind !== 'SFX') throw new HttpError(400, 'kind must be MUSIC or SFX');
  const expectedModel = body.kind === 'MUSIC' ? config.musicModel : config.sfxModel;
  if (body.model !== expectedModel) throw new HttpError(400, 'Unsupported audio model');
  const prompt = body.request?.prompt?.trim(); if (!prompt) throw new HttpError(400, 'Audio prompt is required');
  const duration = body.request?.durationSeconds ?? (body.kind === 'SFX' ? 5 : 30);
  if (!Number.isFinite(duration) || duration <= 0) throw new HttpError(400, 'durationSeconds must be positive');
  if (body.kind === 'MUSIC' && (duration < 3 || duration > 600)) throw new HttpError(400, 'Music duration must be 3-600 seconds');
  if (body.kind === 'SFX' && duration > 30) throw new HttpError(400, 'SFX duration must be at most 30 seconds');
  const idempotencyKey = body.context?.idempotencyKey?.trim(); if (!idempotencyKey) throw new HttpError(400, 'context.idempotencyKey is required');
  return { kind: body.kind, model: expectedModel, prompt, durationSeconds: duration, idempotencyKey };
}

class AudioTaskStore {
  #loaded = false; #tasks: AudioTask[] = [];
  constructor(readonly filename: string) {}
  async load(): Promise<void> { if (this.#loaded) return; try { this.#tasks = JSON.parse(await readFile(this.filename, 'utf8')) as AudioTask[]; } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; } this.#loaded = true; }
  byIdempotency(key: string): AudioTask | undefined { return this.#tasks.find((task) => task.idempotencyKey === key); }
  byGeneration(id: string): AudioTask | undefined { return this.#tasks.find((task) => task.generationId === id); }
  async add(task: AudioTask): Promise<void> { this.#tasks.push(task); await this.#save(); }
  async update(task: AudioTask): Promise<void> { const index = this.#tasks.findIndex((item) => item.generationId === task.generationId); if (index >= 0) this.#tasks[index] = { ...task }; await this.#save(); }
  async #save(): Promise<void> { await mkdir(path.dirname(this.filename), { recursive: true }); const temporary = `${this.filename}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(this.#tasks, null, 2), 'utf8'); await rename(temporary, this.filename); }
}

function signAsset(id: string, expires: number, secret: string): string { return createHmac('sha256', secret).update(`${id}.${expires}`).digest('hex'); }
function verifyAssetSignature(id: string, parameters: URLSearchParams, secret: string, nowMs: number): void {
  const expires = Number(parameters.get('expires')); const signature = parameters.get('signature') ?? '';
  if (!Number.isInteger(expires) || expires < Math.floor(nowMs / 1000)) throw new HttpError(401, 'ASSET_LINK_EXPIRED');
  const expected = signAsset(id, expires, secret); const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'INVALID_ASSET_SIGNATURE');
}
function validateConfig(config: ElevenLabsAudioGatewayConfig): void {
  if (!/^https:\/\//u.test(config.baseUrl)) throw new Error('ELEVENLABS_BASE_URL must use HTTPS');
  if (!/^https?:\/\//u.test(config.publicBaseUrl)) throw new Error('AUDIO_GATEWAY_PUBLIC_BASE_URL must use HTTP(S)');
  for (const [name, value] of Object.entries({ ELEVENLABS_API_KEY: config.apiKey, ELEVENLABS_MUSIC_MODEL: config.musicModel, ELEVENLABS_SFX_MODEL: config.sfxModel, FILMGAME_AUDIO_GATEWAY_TOKEN: config.internalToken, AUDIO_GATEWAY_ASSET_SIGNING_SECRET: config.assetSigningSecret, AUDIO_GATEWAY_ASSET_ROOT: config.assetRoot, AUDIO_GATEWAY_STATE_FILE: config.stateFile })) if (!value.trim()) throw new Error(`${name} is required`);
}
function elevenHeaders(config: ElevenLabsAudioGatewayConfig): Record<string, string> { return { 'xi-api-key': config.apiKey }; }
function trimSlash(value: string): string { return value.replace(/\/$/u, ''); }
async function readJson<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 1_000_000) throw new HttpError(413, 'Request body too large'); chunks.push(buffer); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; } catch { throw new HttpError(400, 'Invalid JSON'); } }
function requireBearer(request: IncomingMessage, expected: string): void { const received = request.headers.authorization?.replace(/^Bearer\s+/iu, '') ?? ''; const a = Buffer.from(received); const b = Buffer.from(expected); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'UNAUTHORIZED'); }
function sendJson(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
