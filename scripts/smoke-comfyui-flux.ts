import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  ComfyUIClient,
  ComfyUIImageProvider,
  FilmGameComfyWorkflowRegistry,
} from '../services/comfyui-adapter/src/index.js';

const client = new ComfyUIClient(
  {
    baseUrl: 'http://127.0.0.1:8188',
    clientId: 'filmgame-flux-smoke',
    timeoutMs: 20 * 60_000,
    pollIntervalMs: 1_000,
    minimumFreeRamBytes: 2 * 1024 ** 3,
  },
  new FilmGameComfyWorkflowRegistry({ outputPrefix: 'filmgame_smoke' }),
);
const provider = new ComfyUIImageProvider(client);
const health = await provider.health();
if (health.status !== 'HEALTHY') throw new Error(health.message ?? 'ComfyUI unavailable');
const result = await provider.generateImage(
  {
    prompt:
      'cinematic establishing shot of an isolated luxury hotel on a mountain during a violent snowstorm at midnight, realistic film still, cold desaturated blue palette, warm tungsten windows, oppressive mystery atmosphere, anamorphic composition, no text',
    width: 768,
    height: 432,
    referenceAssetUris: [],
    workflowId: 'flux-schnell-fp8-v1',
    seed: 1986,
  },
  {
    requestId: 'comfyui-flux-smoke',
    projectId: 'snowbound-hotel',
    storyVersion: 1,
    productionVersion: 1,
    idempotencyKey: 'snowbound-hotel:comfyui-flux-smoke:1986',
  },
);
const response = await fetch(result.data.temporaryUri);
if (!response.ok) throw new Error(`Unable to fetch FLUX output: HTTP ${response.status}`);
const outputDirectory = new URL('../artifacts/comfyui-flux-smoke/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const outputPath = fileURLToPath(new URL('snowbound-hotel.png', outputDirectory));
const bytes = new Uint8Array(await response.arrayBuffer());
await writeFile(outputPath, bytes);
console.log(
  JSON.stringify({
    health: health.status,
    provider: result.provider,
    workflowId: result.metadata.workflowId,
    seed: result.metadata.seed,
    bytes: bytes.byteLength,
    output: outputPath,
  }),
);
