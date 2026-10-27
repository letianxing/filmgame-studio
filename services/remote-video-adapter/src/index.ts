import type {
  GeneratedAsset,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  ProviderUsage,
  VideoGenerationRequest,
  VideoProvider,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';

export interface RemoteVideoConfig {
  baseUrl: string;
  model: string;
  token?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

interface SubmitResponse {
  generationId: string;
}

interface StatusResponse {
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  asset?: GeneratedAsset;
  error?: string;
  providerMetadata?: Record<string, string | number | boolean | null>;
  usage?: ProviderUsage[];
}

export class RemoteVideoProvider implements VideoProvider {
  readonly id = 'remote-video';
  readonly kind = 'VIDEO' as const;
  readonly #baseUrl: string;
  readonly #pollIntervalMs: number;
  readonly #timeoutMs: number;

  constructor(readonly config: RemoteVideoConfig) {
    if (!/^https?:\/\//u.test(config.baseUrl)) throw new Error('Remote video baseUrl must use HTTP(S)');
    if (!config.model.trim()) throw new Error('Remote video model is required');
    this.#baseUrl = config.baseUrl.replace(/\/$/u, '');
    this.#pollIntervalMs = config.pollIntervalMs ?? 2_000;
    this.#timeoutMs = config.timeoutMs ?? 60 * 60_000;
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
        latencyMs: Math.round(performance.now() - started),
        message: cause instanceof Error ? cause.message : 'Remote video service unavailable',
      };
    }
  }

  async generateVideo(
    request: VideoGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = new Date().toISOString();
    const submitted = await this.#request<SubmitResponse>('/v1/video/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.#headers() },
      body: JSON.stringify({
        model: this.config.model,
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
      throw new ProviderError(this.id, 'INVALID_RESPONSE', 'Remote video omitted generationId', false);
    }
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      context.signal?.throwIfAborted();
      const status = await this.#request<StatusResponse>(
        `/v1/video/generations/${encodeURIComponent(submitted.generationId)}`,
        { headers: this.#headers(), signal: context.signal ?? null },
      );
      if (status.status === 'SUCCEEDED' && status.asset) {
        return {
          data: status.asset,
          provider: this.id,
          model: this.config.model,
          requestId: context.requestId,
          startedAt,
          completedAt: new Date().toISOString(),
          usage: status.usage ?? [
            { unit: 'SECONDS', input: 0, output: request.durationSeconds },
          ],
          metadata: {
            generationId: submitted.generationId,
            ...(status.providerMetadata ?? {}),
          },
        };
      }
      if (status.status === 'FAILED' || status.status === 'CANCELLED') {
        throw new ProviderError(
          this.id,
          'INVALID_RESPONSE',
          status.error ?? `Remote video ${status.status.toLowerCase()}`,
          false,
        );
      }
      await delay(this.#pollIntervalMs, context.signal);
    }
    throw new ProviderError(this.id, 'TIMEOUT', 'Remote video generation timed out', true);
  }

  #headers(): Record<string, string> {
    return {
      ...this.config.headers,
      ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
    };
  }

  async #request<T>(pathname: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${pathname}`, init);
    } catch (cause) {
      throw new ProviderError(this.id, 'UNAVAILABLE', 'Unable to reach remote video service', true, cause);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: unknown } | null;
      const detail = typeof payload?.error === 'string' ? payload.error
        .replace(/https?:\/\/[^\s"']+/g, '[provider URL]')
        .replace(/data:[^\s"']+/g, '[inline media]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replaceAll(this.config.token || '\u0000', '[redacted]').slice(0, 1200) : '';
      throw new ProviderError(
        this.id,
        response.status === 429 ? 'QUOTA' : 'INVALID_RESPONSE',
        `Remote video service returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status >= 500 || response.status === 429,
      );
    }
    return (await response.json()) as T;
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
