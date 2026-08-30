import type {
  GeneratedAsset,
  ImageGenerationRequest,
  ImageProvider,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  VideoGenerationRequest,
  VideoProvider,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';
import { openAsBlob } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type ComfyApiWorkflow = Record<string, unknown>;

export interface ComfyWorkflowRegistry {
  image(request: ImageGenerationRequest): Promise<ComfyApiWorkflow>;
  video(request: VideoGenerationRequest): Promise<ComfyApiWorkflow>;
}

export interface ComfyUIConfig {
  baseUrl: string;
  clientId: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  minimumFreeRamBytes?: number;
  headers?: Record<string, string>;
}

interface PromptResponse {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

interface UploadResponse {
  name: string;
  subfolder?: string;
  type?: string;
}

interface HistoryOutput {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface HistoryRecord {
  status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  outputs?: Record<string, { images?: HistoryOutput[]; gifs?: HistoryOutput[]; videos?: HistoryOutput[] }>;
}

export class ComfyUIClient {
  readonly #baseUrl: string;
  readonly #pollIntervalMs: number;
  readonly #timeoutMs: number;
  readonly #minimumFreeRamBytes: number;

  constructor(
    readonly config: ComfyUIConfig,
    readonly workflows: ComfyWorkflowRegistry,
  ) {
    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
    this.#pollIntervalMs = config.pollIntervalMs ?? 1_000;
    this.#timeoutMs = config.timeoutMs ?? 20 * 60_000;
    this.#minimumFreeRamBytes = config.minimumFreeRamBytes ?? 2 * 1024 ** 3;
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.#baseUrl}/system_stats`, {
        headers: this.config.headers ?? {},
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const details = (await response.json()) as Record<string, never>;
      return {
        status: 'HEALTHY',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details,
      };
    } catch (cause) {
      return {
        status: 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        message: cause instanceof Error ? cause.message : 'ComfyUI is unavailable',
      };
    }
  }

  async runWorkflow(
    workflow: ComfyApiWorkflow,
    context: ProviderContext,
  ): Promise<{ asset: GeneratedAsset; promptId: string }> {
    const promptResponse = await this.#request<PromptResponse>('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.config.headers },
      body: JSON.stringify({ prompt: workflow, client_id: this.config.clientId }),
      signal: context.signal ?? null,
    });
    if (!promptResponse.prompt_id || Object.keys(promptResponse.node_errors ?? {}).length) {
      throw new ProviderError(
        'comfyui',
        'INVALID_RESPONSE',
        `ComfyUI rejected workflow ${JSON.stringify(promptResponse.node_errors ?? {})}`,
        false,
      );
    }

    const history = await this.#waitForHistory(promptResponse.prompt_id, context.signal);
    const output = firstOutput(history);
    if (!output) {
      throw new ProviderError(
        'comfyui',
        'INVALID_RESPONSE',
        `ComfyUI prompt ${promptResponse.prompt_id} completed without an asset`,
        false,
      );
    }

    const query = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder ?? '',
      type: output.type ?? 'output',
    });
    return {
      promptId: promptResponse.prompt_id,
      asset: {
        temporaryUri: `${this.#baseUrl}/view?${query.toString()}`,
        mimeType: inferMimeType(output.filename),
      },
    };
  }

  async importImage(sourceUri: string, filename: string): Promise<string> {
    const uri = new URL(sourceUri);
    let image: Blob;
    let contentType: string;
    if (uri.protocol === 'file:') {
      contentType = inferMimeType(fileURLToPath(uri));
      image = await openAsBlob(fileURLToPath(uri), { type: contentType });
    } else {
      let source: Response;
      try {
        source = await fetch(sourceUri, { signal: AbortSignal.timeout(60_000) });
      } catch (cause) {
        throw new ProviderError('comfyui', 'UNAVAILABLE', 'Unable to read the source image', true, cause);
      }
      if (!source.ok) {
        throw new ProviderError(
          'comfyui',
          'INVALID_RESPONSE',
          `Source image returned HTTP ${source.status}`,
          false,
        );
      }
      const declaredBytes = Number(source.headers.get('content-length') ?? 0);
      if (declaredBytes > 64 * 1024 ** 2) {
        throw new ProviderError('comfyui', 'INVALID_RESPONSE', 'Source image exceeds 64 MiB', false);
      }
      contentType = source.headers.get('content-type') ?? 'image/png';
      image = await source.blob();
      if (image.size > 64 * 1024 ** 2) {
        throw new ProviderError('comfyui', 'INVALID_RESPONSE', 'Source image exceeds 64 MiB', false);
      }
    }
    if (!contentType.startsWith('image/')) {
      throw new ProviderError('comfyui', 'INVALID_RESPONSE', 'Source asset is not an image', false);
    }
    const form = new FormData();
    form.append('image', image, safeFilename(filename));
    form.append('subfolder', 'filmgame_ingress');
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const uploaded = await this.#request<UploadResponse>('/upload/image', {
      method: 'POST',
      headers: this.config.headers ?? {},
      body: form,
    });
    if (!uploaded.name) {
      throw new ProviderError('comfyui', 'INVALID_RESPONSE', 'ComfyUI omitted upload name', false);
    }
    return [uploaded.subfolder, uploaded.name].filter(Boolean).join('/');
  }

  async #waitForHistory(promptId: string, signal?: AbortSignal): Promise<HistoryRecord> {
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const history = await this.#request<Record<string, HistoryRecord>>(
        `/history/${encodeURIComponent(promptId)}`,
        { headers: this.config.headers ?? {}, signal: signal ?? null },
      );
      const record = history[promptId];
      if (record?.status?.completed) return record;
      if (record?.status?.status_str === 'error') {
        throw new ProviderError('comfyui', 'INVALID_RESPONSE', `Prompt ${promptId} failed`, false);
      }
      await this.#ensureMemoryHeadroom(promptId);
      await delay(this.#pollIntervalMs, signal);
    }
    throw new ProviderError('comfyui', 'TIMEOUT', `Prompt ${promptId} timed out`, true);
  }

  async #ensureMemoryHeadroom(promptId: string): Promise<void> {
    if (this.#minimumFreeRamBytes <= 0) return;
    const stats = await this.#request<{ system?: { ram_free?: number } }>('/system_stats', {
      headers: this.config.headers ?? {},
      signal: AbortSignal.timeout(3_000),
    });
    const freeRam = stats.system?.ram_free;
    if (typeof freeRam !== 'number' || freeRam >= this.#minimumFreeRamBytes) return;
    try {
      await this.#request<unknown>('/interrupt', {
        method: 'POST',
        headers: this.config.headers ?? {},
      });
    } catch {
      // Preserve the resource-exhaustion error even if interruption races with completion.
    }
    throw new ProviderError(
      'comfyui',
      'UNAVAILABLE',
      `Interrupted prompt ${promptId}: free RAM ${freeRam} is below safety floor ${this.#minimumFreeRamBytes}`,
      false,
    );
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, init);
    } catch (cause) {
      throw new ProviderError('comfyui', 'UNAVAILABLE', 'Unable to reach ComfyUI', true, cause);
    }
    if (!response.ok) {
      throw new ProviderError(
        'comfyui',
        response.status === 429 ? 'QUOTA' : 'INVALID_RESPONSE',
        `ComfyUI returned HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }
    return (await response.json()) as T;
  }
}

export class ComfyUIImageProvider implements ImageProvider {
  readonly id = 'comfyui-image';
  readonly kind = 'IMAGE' as const;

  constructor(readonly client: ComfyUIClient) {}

  health(): Promise<ProviderHealth> {
    return this.client.health();
  }

  async generateImage(
    request: ImageGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = new Date().toISOString();
    const workflow = await this.client.workflows.image(request);
    const { asset, promptId } = await this.client.runWorkflow(workflow, context);
    return {
      data: asset,
      provider: this.id,
      requestId: context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      usage: [{ unit: 'IMAGES', input: 0, output: 1 }],
      metadata: {
        promptId,
        workflowId: request.workflowId ?? 'default',
        seed: request.seed ?? null,
      },
    };
  }
}

export * from './workflows.js';

export class ComfyUIVideoProvider implements VideoProvider {
  readonly id = 'comfyui-video';
  readonly kind = 'VIDEO' as const;

  constructor(readonly client: ComfyUIClient) {}

  health(): Promise<ProviderHealth> {
    return this.client.health();
  }

  async generateVideo(
    request: VideoGenerationRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = new Date().toISOString();
    if (request.referenceAssetUris.length) {
      throw new ProviderError(
        this.id,
        'INVALID_RESPONSE',
        'The selected Wan2.2 workflow accepts one first frame, not arbitrary reference assets',
        false,
      );
    }
    const preparedRequest = request.firstFrameUri
      ? {
          ...request,
          firstFrameUri: `comfy-input://${await this.client.importImage(
            request.firstFrameUri,
            `${context.projectId}-${context.idempotencyKey}.png`,
          )}`,
        }
      : request;
    const workflow = await this.client.workflows.video(preparedRequest);
    const { asset, promptId } = await this.client.runWorkflow(workflow, context);
    return {
      data: asset,
      provider: this.id,
      requestId: context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      usage: [{ unit: 'SECONDS', input: 0, output: request.durationSeconds }],
      metadata: { promptId, workflowId: request.workflowId ?? 'default' },
    };
  }
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
  return normalized || 'filmgame-input.png';
}

function firstOutput(history: HistoryRecord): HistoryOutput | null {
  for (const output of Object.values(history.outputs ?? {})) {
    const candidate = output.videos?.[0] ?? output.gifs?.[0] ?? output.images?.[0];
    if (candidate) return candidate;
  }
  return null;
}

function inferMimeType(filename: string): string {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      mp4: 'video/mp4',
      webm: 'video/webm',
    }[extension ?? ''] ?? 'application/octet-stream'
  );
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
