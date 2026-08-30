import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  ComfyUIClient,
  ComfyUIImageProvider,
  type ComfyWorkflowRegistry,
} from '../services/comfyui-adapter/src/index.js';

const workflows: ComfyWorkflowRegistry = {
  async image(request) {
    return {
      '1': {
        class_type: 'EmptyImage',
        inputs: {
          width: request.width,
          height: request.height,
          batch_size: 1,
          color: 0x101820,
        },
      },
      '2': {
        class_type: 'SaveImage',
        inputs: {
          images: ['1', 0],
          filename_prefix: 'filmgame_adapter_smoke',
        },
      },
    };
  },
  async video() {
    throw new Error('Video smoke workflow is not configured');
  },
};

const client = new ComfyUIClient(
  {
    baseUrl: 'http://127.0.0.1:8188',
    clientId: 'filmgame-adapter-smoke',
    timeoutMs: 60_000,
  },
  workflows,
);
const provider = new ComfyUIImageProvider(client);
const health = await provider.health();
if (health.status !== 'HEALTHY') throw new Error(health.message ?? 'ComfyUI unavailable');
const result = await provider.generateImage(
  {
    prompt: 'Adapter transport smoke test; no AI model is used.',
    width: 512,
    height: 288,
    referenceAssetUris: [],
    workflowId: 'empty-image-smoke-v1',
  },
  {
    requestId: 'comfyui-adapter-smoke',
    projectId: 'snowbound-hotel',
    storyVersion: 1,
    productionVersion: 1,
    idempotencyKey: 'snowbound-hotel:comfyui-adapter-smoke',
  },
);
const response = await fetch(result.data.temporaryUri);
if (!response.ok) throw new Error(`Unable to fetch ComfyUI output: HTTP ${response.status}`);
const outputDirectory = new URL('../artifacts/comfyui-adapter-smoke/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const outputPath = fileURLToPath(new URL('empty-image.png', outputDirectory));
const bytes = new Uint8Array(await response.arrayBuffer());
await writeFile(outputPath, bytes);

console.log(
  JSON.stringify({
    health: health.status,
    provider: result.provider,
    requestId: result.requestId,
    mimeType: result.data.mimeType,
    bytes: bytes.byteLength,
    output: outputPath,
  }),
);

