import type { ProviderContext, ProviderHealth } from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';

export interface SpeechIntentRequest {
  roomId: string;
  sceneId: string;
  roleId: string;
  transcript: string;
  language: string;
}

export interface SpeechIntentCandidate {
  intentType: string;
  targetRoleId?: string;
  topic?: string;
  emotion?: string;
  confidence: number;
  transcript: string;
}

export interface SpeechIntentProvider {
  health(): Promise<ProviderHealth>;
  parseUtterance(
    request: SpeechIntentRequest,
    context: ProviderContext,
  ): Promise<SpeechIntentCandidate>;
}

export interface LiveKitAdapterConfig {
  bridgeBaseUrl: string;
  token?: string;
}

export class LiveKitSpeechIntentAdapter implements SpeechIntentProvider {
  readonly #baseUrl: string;

  constructor(readonly config: LiveKitAdapterConfig) {
    if (!/^https?:\/\//u.test(config.bridgeBaseUrl)) {
      throw new Error('LiveKit bridgeBaseUrl must use HTTP(S)');
    }
    this.#baseUrl = config.bridgeBaseUrl.replace(/\/$/u, '');
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
        message: cause instanceof Error ? cause.message : 'LiveKit bridge unavailable',
      };
    }
  }

  async parseUtterance(
    request: SpeechIntentRequest,
    context: ProviderContext,
  ): Promise<SpeechIntentCandidate> {
    if (!request.transcript.trim() || request.transcript.length > 4_000) {
      throw new Error('Transcript must contain 1-4000 characters');
    }
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}/v1/speech/intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers() },
        body: JSON.stringify({
          request,
          context: {
            requestId: context.requestId,
            projectId: context.projectId,
            storyVersion: context.storyVersion,
            idempotencyKey: context.idempotencyKey,
          },
        }),
        signal: context.signal ?? null,
      });
    } catch (cause) {
      throw new ProviderError('livekit', 'UNAVAILABLE', 'Unable to reach LiveKit bridge', true, cause);
    }
    if (!response.ok) {
      throw new ProviderError(
        'livekit',
        'INVALID_RESPONSE',
        `LiveKit bridge returned HTTP ${response.status}`,
        response.status >= 500,
      );
    }
    const candidate = (await response.json()) as SpeechIntentCandidate;
    if (
      !candidate.intentType ||
      candidate.transcript !== request.transcript ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      throw new ProviderError('livekit', 'INVALID_RESPONSE', 'Invalid speech intent candidate', false);
    }
    return candidate;
  }

  #headers(): Record<string, string> {
    return this.config.token ? { authorization: `Bearer ${this.config.token}` } : {};
  }
}
