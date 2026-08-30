import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  ComfyUIClient,
  ComfyUIVideoProvider,
  FilmGameComfyWorkflowRegistry,
} from '../services/comfyui-adapter/src/index.js';

const minimumFreeRamBytes = Number(process.env.COMFYUI_MINIMUM_FREE_RAM_BYTES ?? 2 * 1024 ** 3);
const client = new ComfyUIClient(
  {
    baseUrl: process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188',
    clientId: 'filmgame-wan-smoke',
    timeoutMs: 30 * 60_000,
    pollIntervalMs: 1_000,
    minimumFreeRamBytes,
  },
  new FilmGameComfyWorkflowRegistry({
    outputPrefix: 'filmgame_smoke',
    videoWidth: 512,
    videoHeight: 288,
    videoFps: 8,
  }),
);
const provider = new ComfyUIVideoProvider(client);
const health = await provider.health();
if (health.status !== 'HEALTHY') throw new Error(health.message ?? 'ComfyUI unavailable');
const result = await provider.generateVideo(
  {
    prompt:
      'Cinematic realistic wide shot of an isolated mountain hotel at night during a snowstorm, snow blowing across frame, warm windows flicker subtly, slow camera push forward, cold desaturated blue palette, no text',
    negativePrompt:
      'static image, overexposed, subtitles, watermark, text, low quality, distorted architecture',
    durationSeconds: 1,
    referenceAssetUris: [],
    workflowId: 'wan2-2-ti2v-5b-v1',
    seed: 1986,
  },
  {
    requestId: 'comfyui-wan-smoke',
    projectId: 'snowbound-hotel',
    storyVersion: 1,
    productionVersion: 1,
    idempotencyKey: 'snowbound-hotel:comfyui-wan-smoke:1986',
  },
);
const response = await fetch(result.data.temporaryUri);
if (!response.ok) throw new Error(`Unable to fetch Wan output: HTTP ${response.status}`);
const outputDirectory = new URL('../artifacts/comfyui-wan-smoke/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const outputPath = fileURLToPath(new URL('snowbound-hotel.mp4', outputDirectory));
const bytes = new Uint8Array(await response.arrayBuffer());
await writeFile(outputPath, bytes);
console.log(
  JSON.stringify({
    health: health.status,
    provider: result.provider,
    workflowId: result.metadata.workflowId,
    bytes: bytes.byteLength,
    output: outputPath,
  }),
);
