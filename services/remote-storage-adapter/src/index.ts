import type {
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  StorageProvider,
  StoredObject,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';

export interface RemoteStorageConfig {
  baseUrl: string;
  token?: string;
}

export class RemoteStorageProvider implements StorageProvider {
  readonly id = 'remote-storage';
  readonly kind = 'STORAGE' as const;
  readonly #baseUrl: string;

  constructor(readonly config: RemoteStorageConfig) {
    if (!/^https?:\/\//u.test(config.baseUrl)) throw new Error('Remote storage baseUrl must use HTTP(S)');
    this.#baseUrl = config.baseUrl.replace(/\/$/u, '');
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.#baseUrl}/health`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(5_000),
      });
      return {
        status: response.ok ? 'HEALTHY' : 'DEGRADED',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        ...(response.ok ? {} : { message: `HTTP ${response.status}` }),
      };
    } catch (cause) {
      return {
        status: 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
        message: cause instanceof Error ? cause.message : 'Remote storage unavailable',
      };
    }
  }

  async put(
    key: string,
    source: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
    context: ProviderContext,
  ): Promise<ProviderResult<StoredObject>> {
    const startedAt = new Date().toISOString();
    const pathname = objectPath(key);
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'PUT',
      headers: {
        ...this.#headers(),
        'content-type': contentType,
        'x-filmgame-idempotency-key': context.idempotencyKey,
        'x-filmgame-request-id': context.requestId,
      },
      body: source as unknown as BodyInit,
      signal: context.signal ?? null,
      ...(source instanceof Uint8Array ? {} : { duplex: 'half' }),
    };
    const stored = await this.#request<StoredObject>(pathname, init);
    if (
      !stored.uri ||
      !/^[a-f0-9]{64}$/u.test(stored.sha256) ||
      !Number.isInteger(stored.sizeBytes) ||
      stored.sizeBytes < 0 ||
      !stored.contentType
    ) {
      throw new ProviderError(this.id, 'INVALID_RESPONSE', 'Invalid remote storage receipt', false);
    }
    return {
      data: stored,
      provider: this.id,
      requestId: context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      usage: [{ unit: 'BYTES', input: stored.sizeBytes, output: stored.sizeBytes }],
      metadata: { key },
    };
  }

  async getSignedReadUri(key: string, expiresInSeconds: number): Promise<string> {
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 86_400) {
      throw new Error('expiresInSeconds must be within 1-86400');
    }
    const response = await this.#request<{ uri: string }>(`${objectPath(key)}/signed-read`, {
      method: 'POST',
      headers: { ...this.#headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ expiresInSeconds }),
    });
    if (!/^https:\/\//u.test(response.uri)) {
      throw new ProviderError(this.id, 'INVALID_RESPONSE', 'Signed read URI must use HTTPS', false);
    }
    return response.uri;
  }

  #headers(): Record<string, string> {
    return this.config.token ? { authorization: `Bearer ${this.config.token}` } : {};
  }

  async #request<T>(pathname: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${pathname}`, init);
    } catch (cause) {
      throw new ProviderError(this.id, 'UNAVAILABLE', 'Unable to reach storage service', true, cause);
    }
    if (!response.ok) {
      throw new ProviderError(
        this.id,
        response.status === 429 ? 'QUOTA' : 'INVALID_RESPONSE',
        `Storage service returned HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }
    return (await response.json()) as T;
  }
}

function objectPath(key: string): string {
  const normalized = key.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || segments.some((segment) => !segment || segment === '..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return `/v1/objects/${segments.map(encodeURIComponent).join('/')}`;
}
