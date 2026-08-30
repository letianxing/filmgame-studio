import type { EntityId, JsonValue } from '@filmgame/shared-types';

export type ProviderKind =
  | 'LLM'
  | 'IMAGE'
  | 'VIDEO'
  | 'TTS'
  | 'MUSIC'
  | 'SFX'
  | 'STORAGE';

export interface ProviderHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNCONFIGURED';
  checkedAt: string;
  latencyMs?: number;
  message?: string;
  details?: Record<string, JsonValue>;
}

export interface ProviderContext {
  requestId: string;
  projectId: EntityId;
  storyVersion: number;
  productionVersion?: number;
  idempotencyKey: string;
  signal?: AbortSignal;
  metadata?: Record<string, JsonValue>;
}

export interface ProviderUsage {
  unit: 'TOKENS' | 'IMAGES' | 'SECONDS' | 'CHARACTERS' | 'BYTES' | 'REQUESTS';
  input: number;
  output: number;
  currency?: string;
  estimatedCost?: number;
}

export interface ProviderResult<T> {
  data: T;
  provider: string;
  model?: string;
  requestId: string;
  startedAt: string;
  completedAt: string;
  usage?: ProviderUsage[];
  metadata: Record<string, JsonValue>;
}

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  health(): Promise<ProviderHealth>;
}

export interface ProviderCapabilities {
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsFirstLastFrame: boolean;
  supportsReferenceImage: boolean;
  supportsCharacterReference: boolean;
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  supportsResolution: boolean;
  supportsDuration: boolean;
  supportsAsyncJob: boolean;
  supportsCancellation: boolean;
  supportsCostEstimate: boolean;
}

export type ProviderCapability = keyof ProviderCapabilities;

export interface ProviderRegistration<TProvider extends Provider = Provider> {
  provider: TProvider;
  capabilities: ProviderCapabilities;
  priority: number;
}

export function defineCapabilities(
  capabilities: Partial<ProviderCapabilities>,
): ProviderCapabilities {
  return {
    supportsTextToImage: false,
    supportsImageToImage: false,
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsFirstLastFrame: false,
    supportsReferenceImage: false,
    supportsCharacterReference: false,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsResolution: false,
    supportsDuration: false,
    supportsAsyncJob: false,
    supportsCancellation: false,
    supportsCostEstimate: false,
    ...capabilities,
  };
}

export class ProviderCapabilityRegistry {
  readonly #registrations = new Map<string, ProviderRegistration>();

  register<TProvider extends Provider>(registration: ProviderRegistration<TProvider>): void {
    if (this.#registrations.has(registration.provider.id)) {
      throw new Error(`Provider capability ${registration.provider.id} is already registered`);
    }
    if (!Number.isFinite(registration.priority)) throw new Error('Provider priority must be finite');
    this.#registrations.set(registration.provider.id, registration);
  }

  select<TProvider extends Provider>(
    kind: ProviderKind,
    required: ProviderCapability[],
  ): Array<ProviderRegistration<TProvider>> {
    return [...this.#registrations.values()]
      .filter(
        (registration) =>
          registration.provider.kind === kind &&
          required.every((capability) => registration.capabilities[capability]),
      )
      .sort((left, right) => right.priority - left.priority)
      .map((registration) => registration as ProviderRegistration<TProvider>);
  }
}

export interface ProviderReliabilityPolicy {
  attemptsPerProvider: number;
  timeoutMs: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
}

export class FallbackVideoProvider implements VideoProvider {
  readonly id = 'fallback-video-chain';
  readonly kind = 'VIDEO' as const;
  readonly #failures = new Map<string, { count: number; openedAt?: number }>();

  constructor(
    readonly registrations: Array<ProviderRegistration<VideoProvider>>,
    readonly requiredCapabilities: ProviderCapability[],
    readonly policy: ProviderReliabilityPolicy = {
      attemptsPerProvider: 2,
      timeoutMs: 30 * 60_000,
      circuitFailureThreshold: 3,
      circuitCooldownMs: 60_000,
    },
  ) {
    if (!registrations.length) throw new Error('FallbackVideoProvider requires providers');
    if (!Number.isInteger(policy.attemptsPerProvider) || policy.attemptsPerProvider < 1) {
      throw new Error('attemptsPerProvider must be positive');
    }
  }

  async health(): Promise<ProviderHealth> {
    const candidates = this.#candidates();
    if (!candidates.length) {
      return { status: 'UNAVAILABLE', checkedAt: new Date().toISOString(), message: 'No capable video provider has a closed circuit' };
    }
    const results = await Promise.all(candidates.map(({ provider }) => provider.health()));
    return {
      status: results.some((result) => result.status === 'HEALTHY') ? 'HEALTHY' : 'DEGRADED',
      checkedAt: new Date().toISOString(),
      details: { candidates: candidates.map(({ provider }) => provider.id) },
    };
  }

  async generateVideo(
    request: VideoGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const errors: string[] = [];
    for (const registration of this.#candidates()) {
      for (let attempt = 1; attempt <= this.policy.attemptsPerProvider; attempt += 1) {
        try {
          const timeout = AbortSignal.timeout(this.policy.timeoutMs);
          const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
          const result = await registration.provider.generateVideo(request, { ...context, signal });
          this.#failures.delete(registration.provider.id);
          return {
            ...result,
            metadata: {
              ...result.metadata,
              selectedProvider: registration.provider.id,
              fallbackAttempt: attempt,
            },
          };
        } catch (cause) {
          const retryable = cause instanceof ProviderError ? cause.retryable : false;
          errors.push(`${registration.provider.id}#${attempt}: ${cause instanceof Error ? cause.message : String(cause)}`);
          this.#recordFailure(registration.provider.id);
          if (!retryable) break;
        }
      }
    }
    throw new ProviderError(
      this.id,
      'UNAVAILABLE',
      `All capable video providers failed: ${errors.join(' | ')}`,
      true,
    );
  }

  #candidates(): Array<ProviderRegistration<VideoProvider>> {
    const now = Date.now();
    return [...this.registrations]
      .filter((registration) =>
        this.requiredCapabilities.every((capability) => registration.capabilities[capability]),
      )
      .filter((registration) => {
        const failure = this.#failures.get(registration.provider.id);
        if (!failure?.openedAt) return true;
        if (now - failure.openedAt >= this.policy.circuitCooldownMs) {
          this.#failures.delete(registration.provider.id);
          return true;
        }
        return false;
      })
      .sort((left, right) => right.priority - left.priority);
  }

  #recordFailure(providerId: string): void {
    const current = this.#failures.get(providerId) ?? { count: 0 };
    current.count += 1;
    if (current.count >= this.policy.circuitFailureThreshold) current.openedAt = Date.now();
    this.#failures.set(providerId, current);
  }
}

export interface LLMStructuredRequest {
  system: string;
  prompt: string;
  jsonSchema: Record<string, JsonValue>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LLMProvider extends Provider {
  readonly kind: 'LLM';
  generateStructured<T extends JsonValue>(
    request: LLMStructuredRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<T>>;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceAssetUris: string[];
  workflowId?: string;
  seed?: number;
}

export interface GeneratedAsset {
  temporaryUri: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  sha256?: string;
}

export interface ImageProvider extends Provider {
  readonly kind: 'IMAGE';
  generateImage(
    request: ImageGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>>;
}

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  durationSeconds: number;
  firstFrameUri?: string;
  lastFrameUri?: string;
  referenceAssetUris: string[];
  workflowId?: string;
  seed?: number;
}

export interface VideoProvider extends Provider {
  readonly kind: 'VIDEO';
  generateVideo(
    request: VideoGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>>;
}

export interface TTSRequest {
  text: string;
  voiceId?: string;
  referenceAudioUri?: string;
  referenceTranscript?: string;
  language: string;
  style: string;
  emotion: string;
  speed: number;
  outputFormat: 'WAV' | 'PCM_S16LE';
}

export interface TTSProvider extends Provider {
  readonly kind: 'TTS';
  synthesize(
    request: TTSRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>>;
}

export interface MusicRequest {
  prompt: string;
  durationSeconds: number;
  seamlessLoop: boolean;
  referenceAssetUris?: string[];
}

export interface MusicProvider extends Provider {
  readonly kind: 'MUSIC';
  generateMusic(
    request: MusicRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>>;
}

export interface SFXRequest {
  prompt: string;
  durationSeconds?: number;
}

export interface SFXProvider extends Provider {
  readonly kind: 'SFX';
  generateSfx(
    request: SFXRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>>;
}

export interface StoredObject {
  uri: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
}

export interface StorageProvider extends Provider {
  readonly kind: 'STORAGE';
  put(
    key: string,
    source: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
    context: ProviderContext,
  ): Promise<ProviderResult<StoredObject>>;
  getSignedReadUri(key: string, expiresInSeconds: number): Promise<string>;
}

export class ProviderRegistry {
  readonly #providers = new Map<string, Provider>();
  readonly #defaults = new Map<ProviderKind, string>();

  register(provider: Provider, options: { default?: boolean } = {}): void {
    if (this.#providers.has(provider.id)) {
      throw new Error(`Provider ${provider.id} is already registered`);
    }
    this.#providers.set(provider.id, provider);
    if (options.default || !this.#defaults.has(provider.kind)) {
      this.#defaults.set(provider.kind, provider.id);
    }
  }

  get<T extends Provider>(kind: ProviderKind, providerId?: string): T {
    const id = providerId ?? this.#defaults.get(kind);
    if (!id) throw new Error(`No ${kind} provider is configured`);
    const provider = this.#providers.get(id);
    if (!provider || provider.kind !== kind) {
      throw new Error(`Provider ${id} is not registered for ${kind}`);
    }
    return provider as T;
  }

  async health(): Promise<Record<string, ProviderHealth>> {
    const results = await Promise.all(
      [...this.#providers.values()].map(async (provider) => [provider.id, await provider.health()] as const),
    );
    return Object.fromEntries(results);
  }
}

export class ProviderError extends Error {
  constructor(
    readonly providerId: string,
    readonly code: 'UNCONFIGURED' | 'UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'SAFETY' | 'QUOTA' | 'UNKNOWN',
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
