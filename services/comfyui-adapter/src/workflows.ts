import type {
  ImageGenerationRequest,
  VideoGenerationRequest,
} from '@filmgame/provider-sdk';

import type { ComfyApiWorkflow, ComfyWorkflowRegistry } from './index.js';

export interface FilmGameComfyWorkflowConfig {
  fluxSchnellCheckpoint?: string;
  wan22DiffusionModel?: string;
  wan22Vae?: string;
  wan22TextEncoder?: string;
  videoWidth?: number;
  videoHeight?: number;
  videoFps?: number;
  outputPrefix?: string;
}

export class FilmGameComfyWorkflowRegistry implements ComfyWorkflowRegistry {
  readonly #fluxCheckpoint: string;
  readonly #wanDiffusionModel: string;
  readonly #wanVae: string;
  readonly #wanTextEncoder: string;
  readonly #videoWidth: number;
  readonly #videoHeight: number;
  readonly #videoFps: number;
  readonly #outputPrefix: string;

  constructor(config: FilmGameComfyWorkflowConfig = {}) {
    this.#fluxCheckpoint = config.fluxSchnellCheckpoint ?? 'flux1-schnell-fp8.safetensors';
    this.#wanDiffusionModel =
      config.wan22DiffusionModel ?? 'wan2.2_ti2v_5B_fp16.safetensors';
    this.#wanVae = config.wan22Vae ?? 'wan2.2_vae.safetensors';
    this.#wanTextEncoder =
      config.wan22TextEncoder ?? 'umt5_xxl_fp8_e4m3fn_scaled.safetensors';
    this.#videoWidth = normalizeVideoDimension(config.videoWidth ?? 832);
    this.#videoHeight = normalizeVideoDimension(config.videoHeight ?? 480);
    this.#videoFps = normalizeFps(config.videoFps ?? 24);
    this.#outputPrefix = config.outputPrefix ?? 'filmgame';
  }

  async image(request: ImageGenerationRequest): Promise<ComfyApiWorkflow> {
    if (request.referenceAssetUris.length) {
      throw new Error(
        'Flux Schnell reference-image workflow is not yet configured; use a consistency workflow ID.',
      );
    }
    if (request.workflowId && request.workflowId !== 'flux-schnell-fp8-v1') {
      throw new Error(`Unsupported image workflow ${request.workflowId}`);
    }
    const width = normalizeDimension(request.width);
    const height = normalizeDimension(request.height);
    const seed = request.seed ?? 1;
    return {
      checkpoint: {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: this.#fluxCheckpoint },
      },
      positive: {
        class_type: 'CLIPTextEncode',
        inputs: { text: request.prompt, clip: ['checkpoint', 1] },
      },
      negative: {
        class_type: 'CLIPTextEncode',
        inputs: { text: '', clip: ['checkpoint', 1] },
      },
      latent: {
        class_type: 'EmptySD3LatentImage',
        inputs: { width, height, batch_size: 1 },
      },
      sampler: {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps: 4,
          cfg: 1,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1,
          model: ['checkpoint', 0],
          positive: ['positive', 0],
          negative: ['negative', 0],
          latent_image: ['latent', 0],
        },
      },
      decode: {
        class_type: 'VAEDecode',
        inputs: { samples: ['sampler', 0], vae: ['checkpoint', 2] },
      },
      save: {
        class_type: 'SaveImage',
        inputs: {
          images: ['decode', 0],
          filename_prefix: `${this.#outputPrefix}/flux_schnell`,
        },
      },
    };
  }

  async video(request: VideoGenerationRequest): Promise<ComfyApiWorkflow> {
    if (request.workflowId && request.workflowId !== 'wan2-2-ti2v-5b-v1') {
      throw new Error(`Unsupported video workflow ${request.workflowId}`);
    }
    if (request.lastFrameUri) {
      throw new Error('Wan2.2 TI2V 5B does not support a last-frame constraint in this workflow.');
    }
    if (request.referenceAssetUris.length) {
      throw new Error(
        'Wan2.2 TI2V accepts a first frame, not arbitrary reference assets.',
      );
    }

    const firstFrame = request.firstFrameUri
      ? parseComfyInputUri(request.firstFrameUri)
      : null;

    const frameCount = normalizeWanFrameCount(request.durationSeconds, this.#videoFps);
    return {
      model: {
        class_type: 'UNETLoader',
        inputs: { unet_name: this.#wanDiffusionModel, weight_dtype: 'default' },
      },
      model_sampling: {
        class_type: 'ModelSamplingSD3',
        inputs: { model: ['model', 0], shift: 8 },
      },
      clip: {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: this.#wanTextEncoder,
          type: 'wan',
          device: 'default',
        },
      },
      vae: {
        class_type: 'VAELoader',
        inputs: { vae_name: this.#wanVae },
      },
      positive: {
        class_type: 'CLIPTextEncode',
        inputs: { text: request.prompt, clip: ['clip', 0] },
      },
      negative: {
        class_type: 'CLIPTextEncode',
        inputs: {
          text:
            request.negativePrompt ??
            'overexposed, static image, blurry details, subtitles, text, watermark, low quality, malformed hands, distorted face, duplicate limbs',
          clip: ['clip', 0],
        },
      },
      latent: {
        class_type: 'Wan22ImageToVideoLatent',
        inputs: {
          vae: ['vae', 0],
          width: this.#videoWidth,
          height: this.#videoHeight,
          length: frameCount,
          batch_size: 1,
          ...(firstFrame ? { start_image: ['first_frame', 0] } : {}),
        },
      },
      ...(firstFrame
        ? {
            first_frame: {
              class_type: 'LoadImage',
              inputs: { image: firstFrame },
            },
          }
        : {}),
      sampler: {
        class_type: 'KSampler',
        inputs: {
          seed: request.seed ?? 1,
          steps: 20,
          cfg: 5,
          sampler_name: 'uni_pc',
          scheduler: 'simple',
          denoise: 1,
          model: ['model_sampling', 0],
          positive: ['positive', 0],
          negative: ['negative', 0],
          latent_image: ['latent', 0],
        },
      },
      decode: {
        class_type: 'VAEDecode',
        inputs: { samples: ['sampler', 0], vae: ['vae', 0] },
      },
      create_video: {
        class_type: 'CreateVideo',
        inputs: { images: ['decode', 0], fps: this.#videoFps },
      },
      save_video: {
        class_type: 'SaveVideo',
        inputs: {
          video: ['create_video', 0],
          filename_prefix: `${this.#outputPrefix}/wan22_ti2v`,
          format: 'auto',
          codec: 'auto',
        },
      },
    };
  }
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value) || value < 256 || value > 2048) {
    throw new Error(`Image dimension ${value} is outside 256-2048`);
  }
  return Math.round(value / 16) * 16;
}

function normalizeVideoDimension(value: number): number {
  if (!Number.isFinite(value) || value < 256 || value > 1280) {
    throw new Error(`Video dimension ${value} is outside 256-1280`);
  }
  return Math.round(value / 32) * 32;
}

function normalizeFps(value: number): number {
  if (!Number.isFinite(value) || value < 1 || value > 60) {
    throw new Error(`Video FPS ${value} is outside 1-60`);
  }
  return Math.round(value);
}

function normalizeWanFrameCount(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 10) {
    throw new Error(`Video duration ${durationSeconds} is outside 0-10 seconds`);
  }
  const requested = Math.max(1, Math.round(durationSeconds * fps));
  return Math.floor((requested - 1) / 4) * 4 + 1;
}

function parseComfyInputUri(value: string): string {
  const prefix = 'comfy-input://';
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    throw new Error(
      'Wan2.2 first frame must be imported through the ComfyUI asset ingress service.',
    );
  }
  const filename = value.slice(prefix.length).replace(/\\/g, '/');
  if (filename.includes('..') || filename.startsWith('/')) {
    throw new Error('Invalid ComfyUI input filename');
  }
  return filename;
}
