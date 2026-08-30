import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defineCapabilities,
  FallbackVideoProvider,
  ProviderError,
  type ProviderContext,
  type VideoGenerationRequest,
  type VideoProvider,
} from '../src/index.js';

function provider(id: string, behavior: 'FAIL' | 'PASS'): VideoProvider {
  return {
    id, kind: 'VIDEO',
    async health() { return { status: 'HEALTHY', checkedAt: new Date().toISOString() }; },
    async generateVideo(_request: VideoGenerationRequest, context: ProviderContext) {
      if (behavior === 'FAIL') throw new ProviderError(id, 'UNAVAILABLE', 'simulated outage', true);
      return {
        data: { temporaryUri: 'https://assets.example/video.mp4', mimeType: 'video/mp4' },
        provider: id, model: 'mock-v1', requestId: context.requestId,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), metadata: {},
      };
    },
  };
}

test('video chain retries primary then falls back without changing consistency inputs', async () => {
  const capable = defineCapabilities({ supportsImageToVideo: true, supportsReferenceImage: true, supportsDuration: true });
  const chain = new FallbackVideoProvider(
    [
      { provider: provider('primary', 'FAIL'), capabilities: capable, priority: 100 },
      { provider: provider('fallback', 'PASS'), capabilities: capable, priority: 10 },
    ],
    ['supportsImageToVideo', 'supportsReferenceImage', 'supportsDuration'],
    { attemptsPerProvider: 2, timeoutMs: 1_000, circuitFailureThreshold: 2, circuitCooldownMs: 60_000 },
  );
  const request = { prompt: 'locked character', durationSeconds: 5, firstFrameUri: 'https://assets.example/ref.png', referenceAssetUris: ['https://assets.example/character.png'] };
  const result = await chain.generateVideo(request, { requestId: 'req', projectId: 'project', storyVersion: 1, productionVersion: 1, idempotencyKey: 'stable-key' });
  assert.equal(result.provider, 'fallback');
  assert.equal(result.metadata.selectedProvider, 'fallback');
});

test('fallback rejects providers that cannot preserve required references', async () => {
  const chain = new FallbackVideoProvider(
    [{ provider: provider('incapable', 'PASS'), capabilities: defineCapabilities({ supportsTextToVideo: true }), priority: 1 }],
    ['supportsImageToVideo', 'supportsReferenceImage'],
    { attemptsPerProvider: 1, timeoutMs: 1_000, circuitFailureThreshold: 1, circuitCooldownMs: 60_000 },
  );
  await assert.rejects(
    chain.generateVideo({ prompt: 'x', durationSeconds: 5, referenceAssetUris: ['https://assets.example/ref.png'] }, { requestId: 'req', projectId: 'project', storyVersion: 1, idempotencyKey: 'stable' }),
    /All capable video providers failed/,
  );
});
