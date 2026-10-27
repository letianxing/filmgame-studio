import { WanMlxVideoProvider } from '../../../services/wan-mlx-adapter/src/index.js';
import type { DramaVideoBackend } from '@filmgame/shared-types';
import { ComfyUIClient, ComfyUIImageProvider, ComfyUIVideoProvider, FilmGameComfyWorkflowRegistry } from '@filmgame/comfyui-adapter';
import { CosyVoiceTTSProvider, LocalTemporaryAssetStager } from '@filmgame/cosyvoice-adapter';
import { RemoteVideoProvider } from '@filmgame/remote-video-adapter';
import { RemoteMusicProvider } from '@filmgame/remote-audio-adapter';
import { MediaPipeline } from '@filmgame/media-pipeline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DramaRenderServices } from './drama-renderer.js';

/** Composition root only: authoring/domain code depends on provider contracts. */
export function createDramaProviders(root: string, backend: DramaVideoBackend = 'SEEDANCE'): DramaRenderServices {
  const required = (key: string): string => { const value = process.env[key]; if (!value) throw new Error(`请配置 ${key}`); return value; };
  const client = new ComfyUIClient({ baseUrl: required('COMFYUI_BASE_URL'), clientId: 'drama-studio', exclusiveQueue: backend === 'WAN', releaseModelsAfterVideo: backend === 'WAN',
    minimumFreeRamBytes: backend === 'WAN' ? Math.max(8 * 1024 ** 3, Number(process.env.COMFYUI_MINIMUM_FREE_RAM_BYTES ?? 0)) : Number(process.env.COMFYUI_MINIMUM_FREE_RAM_BYTES ?? 2 * 1024 ** 3) }, new FilmGameComfyWorkflowRegistry({ wan22TextEncoder: process.env.WAN_TEXT_ENCODER ?? 'umt5_xxl_fp16.safetensors', videoWidth: 512, videoHeight: 288, videoFps: 8, videoSampler: 'euler', videoSteps: 20, textEncoderDevice: 'cpu', tiledVideoDecode: true }));
  if (backend === 'WAN' && process.env.COMFYUI_LOCAL_VIDEO_ENABLED !== 'true') throw new Error('本地 Wan 尚未启用，请先完成模型安装与安全启动；不会自动切换云端');
  const localVideo = () => process.env.WAN_RUNTIME === 'MLX'
    ? new WanMlxVideoProvider({ pythonPath: required('WAN_MLX_PYTHON'), workerPath: path.resolve(process.env.WAN_MLX_WORKER ?? 'scripts/wan-mlx-worker.py'),
      modelDir: required('WAN_MLX_MODEL_DIR'), hfHome: required('WAN_MLX_HF_HOME'), outputDir: path.join(root,'wan-mlx') })
    : new ComfyUIVideoProvider(client);
  const video = backend === 'WAN' ? localVideo() : process.env.REMOTE_VIDEO_BASE_URL && process.env.REMOTE_VIDEO_MODEL
    ? new RemoteVideoProvider({ baseUrl: process.env.REMOTE_VIDEO_BASE_URL, model: process.env.REMOTE_VIDEO_MODEL,
      ...(process.env.REMOTE_VIDEO_API_TOKEN ? { token: process.env.REMOTE_VIDEO_API_TOKEN } : {}) }) : undefined;
  return { image: new ComfyUIImageProvider(client), ...(video ? { video } : {}),
    ...(process.env.REMOTE_AUDIO_BASE_URL && process.env.REMOTE_MUSIC_MODEL ? { music: new RemoteMusicProvider({
      baseUrl: process.env.REMOTE_AUDIO_BASE_URL, musicModel: process.env.REMOTE_MUSIC_MODEL,
      sfxModel: process.env.REMOTE_SFX_MODEL ?? '', ...(process.env.REMOTE_AUDIO_API_TOKEN ? { token: process.env.REMOTE_AUDIO_API_TOKEN } : {}),
    }) } : {}),
    tts: new CosyVoiceTTSProvider({ baseUrl: required('COSYVOICE_BASE_URL'), sampleRateHz: 24000,
      stager: new LocalTemporaryAssetStager(path.join(root, 'tts-staging')) }),
    media: new MediaPipeline({ ffmpegPath: required('FFMPEG_PATH'), ffprobePath: required('FFPROBE_PATH'),
      defaultVideoCodec: process.env.MEDIA_VIDEO_CODEC ?? 'libopenh264' }),
    fingerprint: createHash('sha256').update(backend).update('wan-safe-euler-v2').update(JSON.stringify(['WAN_RUNTIME', 'WAN_MLX_MODEL_DIR', 'WAN_MLX_WORKER', 'WAN_TEXT_ENCODER', 'COMFYUI_LOCAL_VIDEO_ENABLED', 'REMOTE_VIDEO_BASE_URL', 'REMOTE_VIDEO_MODEL',
      'COMFYUI_BASE_URL', 'COSYVOICE_BASE_URL', 'COSYVOICE_MODEL_DIR', 'MEDIA_VIDEO_CODEC'].map((key) => process.env[key] ?? ''))).digest('hex'),
  };
}
