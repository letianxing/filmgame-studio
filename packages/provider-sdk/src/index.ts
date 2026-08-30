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

