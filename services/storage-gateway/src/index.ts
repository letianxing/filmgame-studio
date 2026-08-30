import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export interface StorageGatewayConfig {
  internalToken: string;
  stagingRoot: string;
}
export interface StoredMetadata { sha256: string; sizeBytes: number; contentType: string; }
export interface GatewayObjectStore {
  health(): Promise<void>;
  head(key: string): Promise<StoredMetadata | null>;
  putFile(key: string, filename: string, metadata: StoredMetadata): Promise<void>;
  signedRead(key: string, expiresInSeconds: number): Promise<string>;
  objectUri(key: string): string;
}

export function createStorageGatewayServer(config: StorageGatewayConfig, store: GatewayObjectStore): Server {
  if (!config.internalToken.trim()) throw new Error('FILMGAME_STORAGE_GATEWAY_TOKEN is required');
  if (!path.isAbsolute(config.stagingRoot)) throw new Error('STORAGE_GATEWAY_STAGING_ROOT must be absolute');
  return createServer(async (request, response) => {
    let staged: string | undefined;
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      requireBearer(request, config.internalToken);
      if (request.method === 'GET' && url.pathname === '/health') {
        await store.health(); return sendJson(response, 200, { status: 'HEALTHY', provider: 's3-compatible' });
      }
      const signedMatch = /^\/v1\/objects\/(.+)\/signed-read$/u.exec(url.pathname);
      if (request.method === 'POST' && signedMatch?.[1]) {
        const key = decodeKey(signedMatch[1]); const body = await readJson<{ expiresInSeconds?: number }>(request);
        const expires = body.expiresInSeconds;
        if (!Number.isInteger(expires) || Number(expires) < 1 || Number(expires) > 86_400) throw new HttpError(400, 'expiresInSeconds must be 1-86400');
        const uri = await store.signedRead(key, Number(expires)); return sendJson(response, 200, { uri });
      }
      const objectMatch = /^\/v1\/objects\/(.+)$/u.exec(url.pathname);
      if (request.method === 'PUT' && objectMatch?.[1]) {
        const key = decodeKey(objectMatch[1]);
        if (!request.headers['x-filmgame-idempotency-key']) throw new HttpError(400, 'x-filmgame-idempotency-key is required');
        const contentType = String(request.headers['content-type'] ?? 'application/octet-stream').split(';')[0] ?? 'application/octet-stream';
        await mkdir(config.stagingRoot, { recursive: true });
        staged = path.join(config.stagingRoot, `${createHash('sha256').update(`${key}-${Date.now()}-${Math.random()}`).digest('hex')}.partial`);
        const hash = createHash('sha256'); let sizeBytes = 0;
        const meter = new (await import('node:stream')).Transform({ transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); sizeBytes += chunk.byteLength; callback(null, chunk); } });
        await pipeline(request, meter, createWriteStream(staged, { flags: 'wx' }));
        const metadata = { sha256: hash.digest('hex'), sizeBytes, contentType };
        const existing = await store.head(key);
        if (existing) {
          if (existing.sha256 !== metadata.sha256 || existing.sizeBytes !== metadata.sizeBytes || existing.contentType !== metadata.contentType) throw new HttpError(409, 'Immutable object exists with different content');
        } else {
          await store.putFile(key, staged, metadata);
        }
        return sendJson(response, 200, { uri: store.objectUri(key), ...metadata });
      }
      return sendJson(response, 404, { error: 'NOT_FOUND' });
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : 502;
      return sendJson(response, status, { error: cause instanceof Error ? cause.message : 'Storage gateway error' });
    } finally {
      if (staged) await rm(staged, { force: true }).catch(() => undefined);
    }
  });
}

export interface S3ObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3ObjectStore implements GatewayObjectStore {
  readonly endpoint: URL;
  constructor(readonly config: S3ObjectStoreConfig, readonly fetchImpl: typeof fetch = fetch) {
    if (!/^https:\/\//u.test(config.endpoint)) throw new Error('STORAGE_S3_ENDPOINT must use HTTPS');
    for (const [name, value] of Object.entries({ STORAGE_S3_REGION: config.region, STORAGE_S3_BUCKET: config.bucket, STORAGE_S3_ACCESS_KEY_ID: config.accessKeyId, STORAGE_S3_SECRET_ACCESS_KEY: config.secretAccessKey })) if (!value.trim()) throw new Error(`${name} is required`);
    this.endpoint = new URL(config.endpoint.endsWith('/') ? config.endpoint : `${config.endpoint}/`);
  }
  async health(): Promise<void> {
    const url = this.bucketUrl(); const headers = await signS3Headers('HEAD', url, {}, EMPTY_SHA256, this.config);
    const response = await this.fetchImpl(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`S3 bucket health returned HTTP ${response.status}`);
  }
  async head(key: string): Promise<StoredMetadata | null> {
    const url = this.objectUrl(key); const headers = await signS3Headers('HEAD', url, {}, EMPTY_SHA256, this.config);
    const response = await this.fetchImpl(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`S3 HEAD returned HTTP ${response.status}`);
    const sha256 = response.headers.get('x-amz-meta-sha256') ?? '';
    const sizeBytes = Number(response.headers.get('content-length') ?? '-1');
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
    if (!/^[a-f0-9]{64}$/u.test(sha256) || !Number.isInteger(sizeBytes) || sizeBytes < 0) throw new Error('Existing S3 object lacks FilmGame immutable metadata');
    return { sha256, sizeBytes, contentType };
  }
  async putFile(key: string, filename: string, metadata: StoredMetadata): Promise<void> {
    const details = await stat(filename); if (details.size !== metadata.sizeBytes) throw new Error('Staged file size changed');
    const url = this.objectUrl(key);
    const baseHeaders = { 'content-type': metadata.contentType, 'x-amz-meta-sha256': metadata.sha256, 'if-none-match': '*' };
    const headers = await signS3Headers('PUT', url, baseHeaders, metadata.sha256, this.config);
    const response = await this.fetchImpl(url, { method: 'PUT', headers, body: createReadStream(filename) as unknown as BodyInit, duplex: 'half', signal: AbortSignal.timeout(30 * 60_000) } as RequestInit & { duplex: 'half' });
    if (!response.ok && response.status !== 412) throw new Error(`S3 PUT returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    if (response.status === 412) {
      const existing = await this.head(key);
      if (!existing || existing.sha256 !== metadata.sha256 || existing.sizeBytes !== metadata.sizeBytes) throw new Error('Concurrent immutable S3 write conflict');
    }
  }
  async signedRead(key: string, expiresInSeconds: number): Promise<string> { return presignS3Get(this.objectUrl(key), expiresInSeconds, this.config); }
  objectUri(key: string): string { return `s3://${this.config.bucket}/${normalizeKey(key)}`; }
  bucketUrl(): URL { return new URL(`${encodeURIComponent(this.config.bucket)}/`, this.endpoint); }
  objectUrl(key: string): URL { return new URL(`${encodeURIComponent(this.config.bucket)}/${normalizeKey(key).split('/').map(encodeURIComponent).join('/')}`, this.endpoint); }
}

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

async function signS3Headers(method: string, url: URL, additionalHeaders: Record<string, string>, payloadHash: string, config: S3ObjectStoreConfig, now = new Date()): Promise<Record<string, string>> {
  const timestamp = amzTimestamp(now); const date = timestamp.slice(0, 8); const host = url.host;
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': timestamp, ...additionalHeaders };
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]?.trim().replace(/\s+/gu, ' ') ?? ''}\n`).join('');
  const canonicalRequest = [method, canonicalUri(url), canonicalQuery(url), canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, date, config.region)).update(stringToSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

export function presignS3Get(url: URL, expiresInSeconds: number, config: S3ObjectStoreConfig, now = new Date()): string {
  const timestamp = amzTimestamp(now); const date = timestamp.slice(0, 8); const scope = `${date}/${config.region}/s3/aws4_request`;
  const signed = new URL(url);
  signed.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  signed.searchParams.set('X-Amz-Credential', `${config.accessKeyId}/${scope}`);
  signed.searchParams.set('X-Amz-Date', timestamp);
  signed.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  signed.searchParams.set('X-Amz-SignedHeaders', 'host');
  const canonicalRequest = ['GET', canonicalUri(signed), canonicalQuery(signed), `host:${signed.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  signed.searchParams.set('X-Amz-Signature', createHmac('sha256', signingKey(config.secretAccessKey, date, config.region)).update(stringToSign).digest('hex'));
  return signed.toString();
}

function signingKey(secret: string, date: string, region: string): Buffer { const dateKey = createHmac('sha256', `AWS4${secret}`).update(date).digest(); const regionKey = createHmac('sha256', dateKey).update(region).digest(); const serviceKey = createHmac('sha256', regionKey).update('s3').digest(); return createHmac('sha256', serviceKey).update('aws4_request').digest(); }
function amzTimestamp(date: Date): string { return date.toISOString().replace(/[:-]|\.\d{3}/gu, ''); }
function canonicalUri(url: URL): string { return url.pathname.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/'); }
function canonicalQuery(url: URL): string { return [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&'); }
function normalizeKey(key: string): string { const normalized = key.replace(/\\/gu, '/'); if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '..')) throw new HttpError(400, 'Unsafe storage key'); return normalized; }
function decodeKey(encoded: string): string { return normalizeKey(encoded.split('/').map((part) => decodeURIComponent(part)).join('/')); }
async function readJson<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 65_536) throw new HttpError(413, 'Request body too large'); chunks.push(buffer); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; } catch { throw new HttpError(400, 'Invalid JSON'); } }
function requireBearer(request: IncomingMessage, expected: string): void { const received = request.headers.authorization?.replace(/^Bearer\s+/iu, '') ?? ''; const a = Buffer.from(received); const b = Buffer.from(expected); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'UNAUTHORIZED'); }
function sendJson(response: ServerResponse, status: number, body: unknown): void { if (response.headersSent) return; response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
