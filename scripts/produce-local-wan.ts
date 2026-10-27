/** Small local-only Wan take; never falls back to a remote provider. */
import { mkdir, writeFile, stat, rename } from 'node:fs/promises';
import { WanMlxVideoProvider, type WanMlxProfile } from '../services/wan-mlx-adapter/src/index.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ComfyUIClient, ComfyUIVideoProvider, FilmGameComfyWorkflowRegistry } from '@filmgame/comfyui-adapter';
import { MediaPipeline } from '@filmgame/media-pipeline';
const get = (key: string, fallback?: string) => { const i = process.argv.indexOf(key); const v = i < 0 ? fallback : process.argv[i + 1]; if (!v) throw new Error(`Missing ${key}`); return v; };
const frame = path.resolve(get('--first-frame'));
const output = path.resolve(get('--output'));
const seconds = Number(get('--seconds', '1'));
const profile = get('--profile', '5b') as WanMlxProfile;
if (!['5b', '14b-lightning-evaluation'].includes(profile)) throw new Error('Unsupported Wan profile');
const steps = Number(get('--steps', profile === '5b' ? '20' : '4'));
const seed = Number(get('--seed', '208'));
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned32-bit integer');
if (!(seconds > 0 && seconds <= 4)) throw new Error('Local safe profile permits at most 4 seconds');
if ((await stat(frame)).size > 20 * 1024**2) throw new Error('First frame exceeds20MB');
try { await stat(output); throw new Error('Refusing to overwrite an existing local take'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const client = new ComfyUIClient({ baseUrl: process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188', clientId: 'filmgame-wan-local', exclusiveQueue: true, releaseModelsAfterVideo: true,
  minimumFreeRamBytes: 8 * 1024**3, timeoutMs: 25 * 60_000, pollIntervalMs: 2000 },
new FilmGameComfyWorkflowRegistry({ videoWidth: 512, videoHeight: 288, videoFps: 8, videoSampler: 'euler', videoSteps: steps,
  wan22TextEncoder: process.env.WAN_TEXT_ENCODER ?? 'umt5_xxl_fp16.safetensors', textEncoderDevice: 'cpu', tiledVideoDecode: true }));
const runtime = get('--runtime', process.env.WAN_RUNTIME ?? 'COMFYUI');
if (!['MLX','COMFYUI'].includes(runtime)) throw new Error('Select MLX or COMFYUI runtime');
if (profile !== '5b' && runtime !== 'MLX') throw new Error('14B evaluation profile requires MLX');
if (profile !== '5b' && steps !== 4) throw new Error('14B Lightning requires four steps');
const configured = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Configure ${key}`); return value; };
const provider = runtime === 'MLX' ? new WanMlxVideoProvider({ pythonPath: configured('WAN_MLX_PYTHON'),
  workerPath: path.resolve('scripts/wan-mlx-worker.py'), modelDir: configured('WAN_MLX_MODEL_DIR'),
  hfHome: configured('WAN_MLX_HF_HOME'), outputDir: path.join(path.dirname(output),'mlx-work'), steps, profile,
  ...(profile !== '5b' ? {lightningDir: configured('WAN_MLX_LIGHTNING_DIR')} : {}) }) : new ComfyUIVideoProvider(client);
await mkdir(path.dirname(output), { recursive: true });
const started = Date.now();
const controller = new AbortController();
process.once('SIGINT', () => controller.abort(new Error('Stopped by operator')));
const interval = setInterval(() => console.log(`Local Wan waiting ${Math.round((Date.now()-started)/1000)}s; no cloud task submitted`), 30_000);
try {
  const result = await provider.generateVideo({ prompt: get('--prompt', 'A quiet wooden room, a gentle breeze moves the curtain slightly. Locked camera. No people, no text.'),
    durationSeconds: seconds, firstFrameUri: pathToFileURL(frame).href, referenceAssetUris: [], generateAudio: false,
    negativePrompt: get('--negative-prompt', 'distorted anatomy, duplicate people, extra limbs, altered faces, disappearing beard, camera movement, flicker, text, subtitles'),
    workflowId: profile === '5b' ? 'wan2-2-ti2v-5b-v1' : 'wan2-2-i2v-14b-lightning-evaluation-v1', seed },
    { requestId: `local-wan-${started}`, projectId: 'wolong-local-test', storyVersion: 1, idempotencyKey: `local-wan-${started}`, signal: controller.signal });
  const partial = output + '.partial.mp4';
  if (result.data.temporaryUri.startsWith('file:')) {
    await pipeline(createReadStream(fileURLToPath(result.data.temporaryUri)), createWriteStream(partial, {flags: 'wx'}));
  } else {
    const response = await fetch(result.data.temporaryUri, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial, {flags: 'wx'}));
  }
  const media = new MediaPipeline({ ffmpegPath: process.env.FFMPEG_PATH ?? '', ffprobePath: process.env.FFPROBE_PATH ?? '' });
  const qa = await media.validateTechnical(partial, { requireVideo: true, requireAudio: false });
  if (!qa.valid) throw new Error(JSON.stringify(qa.issues));
  await rename(partial, output);
  await writeFile(output+'.receipt.json', JSON.stringify({ provider: result.provider, model: result.model ?? 'Wan2.2-TI2V-5B', runtime, sampler: 'euler', steps, seed,
    qa, elapsedSeconds: (Date.now()-started)/1000, metadata: result.metadata, audio: 'none: model is video-only',
    purpose: 'local feasibility test, not approved episode footage', cloudVideoTasks: 0 }, null, 2));
  console.log(JSON.stringify({ file: output, qa, elapsedSeconds: (Date.now()-started)/1000 }));
} finally { clearInterval(interval); }
