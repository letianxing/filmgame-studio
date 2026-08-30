import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  CosyVoiceTTSProvider,
  type TemporaryAssetStager,
} from '../services/cosyvoice-adapter/src/index.js';

const outputDirectory = new URL('../artifacts/cosyvoice-adapter-smoke/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const referenceBytes = await readFile(String.raw`G:\filmGame\CosyVoice\asset\zero_shot_prompt.wav`);
const referenceDataUri = `data:audio/wav;base64,${referenceBytes.toString('base64')}`;

const stager: TemporaryAssetStager = {
  async put(bytes, options) {
    const path = fileURLToPath(new URL(`adapter-output.${options.extension}`, outputDirectory));
    await writeFile(path, bytes);
    return new URL(`adapter-output.${options.extension}`, outputDirectory).href;
  },
};

const provider = new CosyVoiceTTSProvider({
  baseUrl: 'http://127.0.0.1:50000',
  sampleRateHz: 24_000,
  stager,
});
const health = await provider.health();
if (health.status !== 'HEALTHY') throw new Error(health.message ?? 'CosyVoice service unavailable');
const result = await provider.synthesize(
  {
    text: '档案室的门刚刚被人打开过。',
    referenceAudioUri: referenceDataUri,
    referenceTranscript: '希望你以后能够做的比我还好呦。',
    language: 'zh-CN',
    style: '',
    emotion: '',
    speed: 1,
    outputFormat: 'WAV',
  },
  {
    requestId: 'cosyvoice-adapter-smoke',
    projectId: 'snowbound-hotel',
    storyVersion: 1,
    productionVersion: 1,
    idempotencyKey: 'snowbound-hotel:cosyvoice-adapter-smoke',
  },
);

console.log(
  JSON.stringify({
    health: health.status,
    provider: result.provider,
    mimeType: result.data.mimeType,
    sizeBytes: result.data.sizeBytes,
    uri: result.data.temporaryUri,
  }),
);
