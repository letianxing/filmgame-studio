import type {
  GeneratedAsset,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  TTSProvider,
  TTSRequest,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface TemporaryAssetStager {
  put(
    bytes: Uint8Array,
    options: { contentType: string; extension: string; requestId: string },
  ): Promise<string>;
}

export interface CosyVoiceConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  sampleRateHz?: number;
  stager: TemporaryAssetStager;
}

export class LocalTemporaryAssetStager implements TemporaryAssetStager {
  readonly #root: string;

  constructor(rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new Error('TTS staging root must be absolute');
    this.#root = path.resolve(rootDirectory);
  }

  async put(
    bytes: Uint8Array,
    options: { contentType: string; extension: string; requestId: string },
  ): Promise<string> {
    await mkdir(this.#root, { recursive: true });
    const name = `${safeName(options.requestId)}.${safeExtension(options.extension)}`;
    const destination = path.resolve(this.#root, name);
    if (!destination.startsWith(`${this.#root}${path.sep}`)) throw new Error('Unsafe TTS stage path');
    const temporary = `${destination}.${randomUUID()}.partial`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    try {
      const existing = await existingFile(destination);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (existing) {
        if (existing.size !== bytes.byteLength || existing.sha256 !== digest) {
          throw new Error(`TTS stage collision for ${options.requestId}`);
        }
        await rm(temporary, { force: true });
      } else {
        await rename(temporary, destination);
      }
      return pathToFileURL(destination).href;
    } catch (cause) {
      await rm(temporary, { force: true });
      throw cause;
    }
  }
}

export class CosyVoiceTTSProvider implements TTSProvider {
  readonly id = 'cosyvoice';
  readonly kind = 'TTS' as const;
  readonly #baseUrl: string;

  constructor(readonly config: CosyVoiceConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.#baseUrl}/health`, {
        headers: this.config.headers ?? {},
        signal: AbortSignal.timeout(3_000),
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
        message: cause instanceof Error ? cause.message : 'CosyVoice is unavailable',
      };
    }
  }

  async synthesize(
    request: TTSRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = new Date().toISOString();
    const form = new FormData();
    form.set('tts_text', request.text);
    form.set('speed', String(request.speed));
    const endpoint = await this.#populateMode(form, request, context.signal);
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs ?? 10 * 60_000);
    const signal = combineSignals(context.signal, timeoutSignal);

    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${endpoint}`, {
        method: 'POST',
        headers: this.config.headers ?? {},
        body: form,
        signal,
      });
    } catch (cause) {
      throw new ProviderError(this.id, 'UNAVAILABLE', 'Unable to reach CosyVoice', true, cause);
    }
    if (!response.ok) {
      throw new ProviderError(
        this.id,
        response.status === 429 ? 'QUOTA' : 'INVALID_RESPONSE',
        `CosyVoice returned HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }

    const pcmBytes = new Uint8Array(await response.arrayBuffer());
    if (!pcmBytes.length) {
      throw new ProviderError(this.id, 'INVALID_RESPONSE', 'CosyVoice returned empty audio', false);
    }
    const sampleRateHz = this.config.sampleRateHz ?? 24_000;
    const bytes = request.outputFormat === 'WAV' ? wrapPcmAsWav(pcmBytes, sampleRateHz) : pcmBytes;
    const contentType = request.outputFormat === 'WAV' ? 'audio/wav' : 'audio/L16';
    const temporaryUri = await this.config.stager.put(bytes, {
      contentType,
      extension: request.outputFormat === 'WAV' ? 'wav' : 'pcm',
      requestId: context.requestId,
    });

    return {
      data: { temporaryUri, mimeType: contentType, sizeBytes: bytes.byteLength },
      provider: this.id,
      requestId: context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      usage: [{ unit: 'CHARACTERS', input: request.text.length, output: bytes.byteLength }],
      metadata: {
        endpoint,
        language: request.language,
        outputFormat: request.outputFormat,
        rawSampleFormat: 'signed-16-bit-pcm',
        sampleRateHz,
      },
    };
  }

  async #populateMode(
    form: FormData,
    request: TTSRequest,
    signal?: AbortSignal,
  ): Promise<string> {
    if (request.referenceAudioUri) {
      const reference = await fetch(request.referenceAudioUri, { signal: signal ?? null });
      if (!reference.ok) {
        throw new ProviderError(
          this.id,
          'INVALID_RESPONSE',
          `Unable to read voice reference: HTTP ${reference.status}`,
          false,
        );
      }
      form.set('prompt_wav', await reference.blob(), 'reference.wav');
      if (request.style || request.emotion) {
        form.set('instruct_text', [request.style, request.emotion].filter(Boolean).join('，'));
        return '/inference_instruct2';
      }
      if (request.referenceTranscript) {
        form.set('prompt_text', request.referenceTranscript);
        return '/inference_zero_shot';
      }
      return '/inference_cross_lingual';
    }

    if (!request.voiceId) {
      throw new ProviderError(
        this.id,
        'UNCONFIGURED',
        'CosyVoice requires voiceId or referenceAudioUri',
        false,
      );
    }
    form.set('spk_id', request.voiceId);
    if (request.style || request.emotion) {
      form.set('instruct_text', [request.style, request.emotion].filter(Boolean).join('，'));
      return '/inference_instruct';
    }
    return '/inference_sft';
  }
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  return active.length === 1 ? active[0]! : AbortSignal.any(active);
}

function wrapPcmAsWav(pcm: Uint8Array, sampleRateHz: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set(new Uint8Array(header));
  wav.set(pcm, 44);
  return wav;
}

async function existingFile(filename: string): Promise<{ size: number; sha256: string } | null> {
  try {
    const details = await stat(filename);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return {
      size: details.size,
      sha256: hash.digest('hex'),
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'tts-output';
}

function safeExtension(value: string): string {
  if (!/^[a-zA-Z0-9]{1,8}$/u.test(value)) throw new Error('Unsafe TTS extension');
  return value.toLowerCase();
}
