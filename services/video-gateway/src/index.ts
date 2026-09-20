import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ArkVideoGatewayConfig {
  arkBaseUrl: string;
  arkApiKey: string;
  arkVideoModel: string;
  internalToken: string;
  publicModel: string;
  stateFile: string;
}

export interface VideoGatewayDependencies {
  fetch?: typeof fetch;
}

interface GatewayRequest {
  model?: string;
  request?: {
    prompt?: string;
    negativePrompt?: string;
    durationSeconds?: number;
    firstFrameUri?: string;
    lastFrameUri?: string;
    referenceAssetUris?: string[];
    referenceVideoUris?: string[];
    seed?: number;
    /** Ark `camera_fixed`: hard-locks the camera instead of relying on prompt wording. */
    cameraFixed?: boolean;
    /** Ark `generate_audio`: defaults to true upstream, so pass false to get a silent track. */
    generateAudio?: boolean;
    /** Ark `omni_reference_task_type`: auto | reference | edit | extend. */
    omniReferenceTaskType?: 'auto' | 'reference' | 'edit' | 'extend';
  };
  context?: { idempotencyKey?: string };
}

interface StoredTask {
  generationId: string;
  upstreamId: string;
  idempotencyKey: string;
}

interface ArkTask {
  id?: string;
  status?: 'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed' | 'expired';
  content?: { video_url?: string };
  duration?: string | number;
  error?: { code?: string; message?: string };
  usage?: { completion_tokens?: number; total_tokens?: number };
}

export function createArkVideoGatewayServer(
  config: ArkVideoGatewayConfig,
  dependencies: VideoGatewayDependencies = {},
): Server {
  validateConfig(config);
  const fetchImpl = dependencies.fetch ?? fetch;
  const store = new VideoTaskStore(config.stateFile);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        requireBearer(request, config.internalToken);
        const upstream = await fetchImpl(
          `${trimSlash(config.arkBaseUrl)}/contents/generations/tasks?page_num=1&page_size=1`,
          { headers: arkHeaders(config), signal: AbortSignal.timeout(8_000) },
        );
        return sendJson(response, upstream.ok ? 200 : 503, {
          status: upstream.ok ? 'HEALTHY' : 'DEGRADED',
          upstreamStatus: upstream.status,
          provider: 'volcengine-ark-seedance',
        });
      }
      requireBearer(request, config.internalToken);
      if (request.method === 'POST' && url.pathname === '/v1/video/generations') {
        const body = await readJson<GatewayRequest>(request);
        const generation = validateGeneration(body, config.publicModel);
        await store.load();
        const existing = store.byIdempotency(generation.idempotencyKey);
        if (existing) return sendJson(response, 200, { generationId: existing.generationId });

        const upstream = await fetchImpl(`${trimSlash(config.arkBaseUrl)}/contents/generations/tasks`, {
          method: 'POST',
          headers: { ...arkHeaders(config), 'content-type': 'application/json' },
          body: JSON.stringify(toArkRequest(generation.request, config.arkVideoModel)),
          signal: AbortSignal.timeout(30_000),
        });
        const payload = (await readUpstreamJson(upstream)) as { id?: string; error?: { message?: string } };
        if (!upstream.ok || !payload.id) {
          return sendJson(response, upstream.status === 429 ? 429 : 502, {
            error: payload.error?.message ?? `Ark submit returned HTTP ${upstream.status}`,
          });
        }
        const task: StoredTask = {
          generationId: randomUUID(),
          upstreamId: payload.id,
          idempotencyKey: generation.idempotencyKey,
        };
        await store.add(task);
        return sendJson(response, 202, { generationId: task.generationId });
      }

      const match = /^\/v1\/video\/generations\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'GET' && match?.[1]) {
        await store.load();
        const task = store.byGeneration(decodeURIComponent(match[1]));
        if (!task) return sendJson(response, 404, { error: 'GENERATION_NOT_FOUND' });
        const upstream = await fetchImpl(
          `${trimSlash(config.arkBaseUrl)}/contents/generations/tasks/${encodeURIComponent(task.upstreamId)}`,
          { headers: arkHeaders(config), signal: AbortSignal.timeout(10_000) },
        );
        const payload = (await readUpstreamJson(upstream)) as ArkTask;
        if (!upstream.ok) return sendJson(response, upstream.status === 429 ? 429 : 502, { error: `Ark poll returned HTTP ${upstream.status}` });
        return sendJson(response, 200, mapArkStatus(payload));
      }
      return sendJson(response, 404, { error: 'NOT_FOUND' });
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 500;
      return sendJson(response, status, { error: cause instanceof Error ? cause.message : 'Internal gateway error' });
    }
  });
}

function toArkRequest(request: NonNullable<GatewayRequest['request']>, model: string): Record<string, unknown> {
  const prompt = request.negativePrompt
    ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}`
    : request.prompt;
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  // Ark distinguishes the roles: `first_frame`/`last_frame` anchor the shot, while
  // `reference_image` only suggests subject and style. Sending a first frame as a
  // reference lets the model re-frame and re-stage the shot.
  const images: Array<[string | undefined, string]> = [
    [request.firstFrameUri, 'first_frame'],
    ...(request.referenceAssetUris ?? []).map((uri): [string, string] => [uri, 'reference_image']),
    [request.lastFrameUri, 'last_frame'],
  ];
  for (const [uri, role] of images) {
    if (uri) content.push({ type: 'image_url', image_url: { url: uri }, role });
  }
  // Reference videos are what `omni_reference_task_type: 'extend'` continues from.
  for (const uri of request.referenceVideoUris ?? []) {
    content.push({ type: 'video_url', video_url: { url: uri }, role: 'reference_video' });
  }
  return {
    model,
    content,
    duration: Math.round(request.durationSeconds ?? 5),
    watermark: false,
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    ...(request.cameraFixed === undefined ? {} : { camera_fixed: request.cameraFixed }),
    ...(request.generateAudio === undefined ? {} : { generate_audio: request.generateAudio }),
    ...(request.omniReferenceTaskType === undefined
      ? {}
      : { omni_reference_task_type: request.omniReferenceTaskType }),
  };
}

function mapArkStatus(task: ArkTask): Record<string, unknown> {
  const statusMap: Record<string, string> = {
    queued: 'QUEUED', running: 'RUNNING', succeeded: 'SUCCEEDED', failed: 'FAILED',
    cancelled: 'CANCELLED', expired: 'FAILED',
  };
  const status = task.status ? statusMap[task.status] : undefined;
  if (!status) return { status: 'FAILED', error: 'Ark response omitted a recognized status' };
  if (status === 'SUCCEEDED') {
    if (!task.content?.video_url) return { status: 'FAILED', error: 'Ark succeeded without video_url' };
    return {
      status,
      asset: {
        temporaryUri: task.content.video_url,
        mimeType: 'video/mp4',
        durationSeconds: task.duration === undefined ? undefined : Number(task.duration),
      },
      usage: [{ unit: 'TOKENS', input: 0, output: task.usage?.completion_tokens ?? task.usage?.total_tokens ?? 0 }],
      providerMetadata: { upstreamRequestId: task.id ?? '' },
    };
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return { status, error: task.error?.message ?? task.error?.code ?? `Ark task ${task.status}` };
  }
  return { status };
}

function validateGeneration(body: GatewayRequest, publicModel: string) {
  if (body.model !== publicModel) throw new HttpError(400, 'Unsupported FilmGame video model alias');
  const request = body.request;
  if (!request?.prompt?.trim()) throw new HttpError(400, 'Video prompt is required');
  // -1 is Ark's "keep the source length" sentinel, required by edit/extend tasks.
  const duration = Number(request.durationSeconds);
  if (!Number.isFinite(duration) || (duration < 1 && duration !== -1)) {
    throw new HttpError(400, 'durationSeconds must be positive, or -1 to keep the source length');
  }
  const taskType = request.omniReferenceTaskType;
  if (taskType !== undefined && !['auto', 'reference', 'edit', 'extend'].includes(taskType)) {
    throw new HttpError(400, 'omniReferenceTaskType must be auto, reference, edit or extend');
  }
  const idempotencyKey = body.context?.idempotencyKey;
  if (!idempotencyKey?.trim()) throw new HttpError(400, 'context.idempotencyKey is required');
  return { request, idempotencyKey };
}

class VideoTaskStore {
  #loaded = false;
  #tasks: StoredTask[] = [];
  #writing: Promise<void> = Promise.resolve();
  #saveCount = 0;
  constructor(readonly filename: string) {}
  async load(): Promise<void> {
    if (this.#loaded) return;
    try { this.#tasks = JSON.parse(await readFile(this.filename, 'utf8')) as StoredTask[]; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    this.#loaded = true;
  }
  byIdempotency(key: string): StoredTask | undefined { return this.#tasks.find((task) => task.idempotencyKey === key); }
  byGeneration(id: string): StoredTask | undefined { return this.#tasks.find((task) => task.generationId === id); }
  async add(task: StoredTask): Promise<void> {
    this.#tasks.push(task);
    await this.#save();
  }

  /**
   * Serialise saves. Two concurrent submissions would otherwise share one temp path:
   * they truncate each other's bytes and then race on rename, where the loser fails with
   * ENOENT and loses its idempotency record.
   */
  async #save(): Promise<void> {
    const write = (): Promise<void> => this.#writeSnapshot();
    const run = this.#writing.then(write, write);
    this.#writing = run.catch(() => undefined); // a failed save must not poison later ones
    return run;
  }

  async #writeSnapshot(): Promise<void> {
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.${++this.#saveCount}.tmp`;
    await writeFile(temporary, JSON.stringify(this.#tasks, null, 2), 'utf8');
    await rename(temporary, this.filename);
  }
}

function validateConfig(config: ArkVideoGatewayConfig): void {
  if (!/^https:\/\//u.test(config.arkBaseUrl)) throw new Error('ARK_BASE_URL must use HTTPS');
  for (const [name, value] of Object.entries({ ARK_API_KEY: config.arkApiKey, ARK_VIDEO_MODEL: config.arkVideoModel, FILMGAME_VIDEO_GATEWAY_TOKEN: config.internalToken, VIDEO_GATEWAY_PUBLIC_MODEL: config.publicModel, VIDEO_GATEWAY_STATE_FILE: config.stateFile })) {
    if (!value.trim()) throw new Error(`${name} is required`);
  }
}

function arkHeaders(config: ArkVideoGatewayConfig): Record<string, string> {
  return { authorization: `Bearer ${config.arkApiKey}`, accept: 'application/json' };
}
function trimSlash(value: string): string { return value.replace(/\/$/u, ''); }
async function readUpstreamJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: { message: text.slice(0, 500) } }; }
}
async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 1_000_000) throw new HttpError(413, 'Request body too large'); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; } catch { throw new HttpError(400, 'Invalid JSON'); }
}
function requireBearer(request: IncomingMessage, expected: string): void {
  const received = request.headers.authorization?.replace(/^Bearer\s+/iu, '') ?? '';
  const a = Buffer.from(received); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'UNAUTHORIZED');
}
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body));
}
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
