import type {
  GeneratedAsset,
  MusicProvider,
  MusicRequest,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  ProviderUsage,
  SFXProvider,
  SFXRequest,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';

export interface RemoteAudioConfig {
  baseUrl: string;
  token?: string;
  musicModel: string;
  sfxModel: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface AudioStatus {
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  asset?: GeneratedAsset;
  error?: string;
  usage?: ProviderUsage[];
}

class RemoteAudioClient {
  readonly baseUrl: string;

  constructor(readonly config: RemoteAudioConfig) {
    if (!/^https?:\/\//u.test(config.baseUrl)) throw new Error('Remote audio baseUrl must use HTTP(S)');
    this.baseUrl = config.baseUrl.replace(/\/$/u, '');
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers(),
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
        message: cause instanceof Error ? cause.message : 'Remote audio service unavailable',
      };
    }
  }

  async generate(
    kind: 'MUSIC' | 'SFX',
    model: string,
    request: MusicRequest | SFXRequest,
    context: ProviderContext,
  ): Promise<{ asset: GeneratedAsset; generationId: string; usage?: ProviderUsage[] }> {
    const submitted = await this.request<{ generationId: string }>('/v1/audio/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers() },
      body: JSON.stringify({
        kind,
        model,
        request,
        context: {
          requestId: context.requestId,
          projectId: context.projectId,
          storyVersion: context.storyVersion,
          productionVersion: context.productionVersion,
          idempotencyKey: context.idempotencyKey,
        },
      }),
      signal: context.signal ?? null,
    });
    if (!submitted.generationId) {
      throw new ProviderError('remote-audio', 'INVALID_RESPONSE', 'Audio service omitted generationId', false);
    }
    const deadline = Date.now() + (this.config.timeoutMs ?? 30 * 60_000);
    while (Date.now() < deadline) {
      context.signal?.throwIfAborted();
      const status = await this.request<AudioStatus>(
        `/v1/audio/generations/${encodeURIComponent(submitted.generationId)}`,
        { headers: this.headers(), signal: context.signal ?? null },
      );
      if (status.status === 'SUCCEEDED' && status.asset) {
        return {
          asset: status.asset,
          generationId: submitted.generationId,
          ...(status.usage ? { usage: status.usage } : {}),
        };
      }
      if (status.status === 'FAILED' || status.status === 'CANCELLED') {
        throw new ProviderError(
          'remote-audio',
          'INVALID_RESPONSE',
          status.error ?? `Audio generation ${status.status.toLowerCase()}`,
          false,
        );
      }
      await delay(this.config.pollIntervalMs ?? 2_000, context.signal);
    }
    throw new ProviderError('remote-audio', 'TIMEOUT', 'Audio generation timed out', true);
  }

  headers(): Record<string, string> {
    return this.config.token ? { authorization: `Bearer ${this.config.token}` } : {};
  }

  async request<T>(pathname: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, init);
    } catch (cause) {
      throw new ProviderError('remote-audio', 'UNAVAILABLE', 'Unable to reach audio service', true, cause);
    }
    if (!response.ok) {
      throw new ProviderError(
        'remote-audio',
        response.status === 429 ? 'QUOTA' : 'INVALID_RESPONSE',
        `Audio service returned HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }
    return (await response.json()) as T;
  }
}

export class RemoteMusicProvider implements MusicProvider {
  readonly id = 'remote-music';
  readonly kind = 'MUSIC' as const;
  readonly client: RemoteAudioClient;
  constructor(readonly config: RemoteAudioConfig) {
    this.client = new RemoteAudioClient(config);
  }
  health(): Promise<ProviderHealth> {
    return this.client.health();
  }
  async generateMusic(
    request: MusicRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = new Date().toISOString();
    const result = await this.client.generate('MUSIC', this.config.musicModel, request, context);
    return providerResult(this.id, this.config.musicModel, request.durationSeconds, context, startedAt, result);
  }
}

export class RemoteSfxProvider implements SFXProvider {
  readonly id = 'remote-sfx';
  readonly kind = 'SFX' as const;
  readonly client: RemoteAudioClient;
  constructor(readonly config: RemoteAudioConfig) {
    this.client = new RemoteAudioClient(config);
  }
  health(): Promise<ProviderHealth> {
    return this.client.health();
  }
  async generateSfx(
    request: SFXRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = new Date().toISOString();
    const result = await this.client.generate('SFX', this.config.sfxModel, request, context);
    return providerResult(this.id, this.config.sfxModel, request.durationSeconds ?? 0, context, startedAt, result);
  }
}

function providerResult(
  provider: string,
  model: string,
  seconds: number,
  context: ProviderContext,
  startedAt: string,
  result: { asset: GeneratedAsset; generationId: string; usage?: ProviderUsage[] },
): ProviderResult<GeneratedAsset> {
  return {
    data: result.asset,
    provider,
    model,
    requestId: context.requestId,
    startedAt,
    completedAt: new Date().toISOString(),
    usage: result.usage ?? [{ unit: 'SECONDS', input: 0, output: seconds }],
    metadata: { generationId: result.generationId },
  };
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}
