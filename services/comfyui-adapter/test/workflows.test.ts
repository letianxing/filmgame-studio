import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { ComfyUIClient } from '../src/index.js';
import { FilmGameComfyWorkflowRegistry } from '../src/workflows.js';

test('Wan2.2 workflow is deterministic and duration maps to a 4n+1 frame count', async () => {
  const registry = new FilmGameComfyWorkflowRegistry({
    videoWidth: 640,
    videoHeight: 384,
    videoFps: 16,
  });
  const workflow = await registry.video({
    prompt: 'A detective crosses a snowbound hotel lobby.',
    durationSeconds: 2,
    referenceAssetUris: [],
    workflowId: 'wan2-2-ti2v-5b-v1',
    seed: 42,
  });

  assert.deepEqual(workflow.latent, {
    class_type: 'Wan22ImageToVideoLatent',
    inputs: {
      vae: ['vae', 0],
      width: 640,
      height: 384,
      length: 29,
      batch_size: 1,
    },
  });
  assert.equal((workflow.sampler as { inputs: { seed: number } }).inputs.seed, 42);
  assert.equal((workflow.save_video as { class_type: string }).class_type, 'SaveVideo');
});

test('Wan2.2 workflow refuses silent reference-image loss', async () => {
  const registry = new FilmGameComfyWorkflowRegistry();
  await assert.rejects(
    registry.video({
      prompt: 'Camera pushes toward the hotel.',
      durationSeconds: 2,
      firstFrameUri: 'r2://shots/SC001_SH01.png',
      referenceAssetUris: [],
    }),
    /asset ingress service/,
  );
});

test('Wan2.2 workflow connects an imported first frame to the latent node', async () => {
  const registry = new FilmGameComfyWorkflowRegistry({ videoFps: 8 });
  const workflow = await registry.video({
    prompt: 'Snow moves across the hotel entrance.',
    durationSeconds: 1,
    firstFrameUri: 'comfy-input://filmgame_ingress/SC001_SH01.png',
    referenceAssetUris: [],
  });

  assert.deepEqual(workflow.first_frame, {
    class_type: 'LoadImage',
    inputs: { image: 'filmgame_ingress/SC001_SH01.png' },
  });
  assert.deepEqual(
    (workflow.latent as { inputs: { start_image: [string, number] } }).inputs.start_image,
    ['first_frame', 0],
  );
});

test('ComfyUI client interrupts a job before local RAM exhaustion', async () => {
  let interrupted = false;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/prompt' && request.method === 'POST') {
      response.end(JSON.stringify({ prompt_id: 'memory-guard-test' }));
      return;
    }
    if (request.url === '/history/memory-guard-test') {
      response.end(
        JSON.stringify({
          'memory-guard-test': { status: { completed: false, status_str: 'running' } },
        }),
      );
      return;
    }
    if (request.url === '/system_stats') {
      response.end(JSON.stringify({ system: { ram_free: 99 } }));
      return;
    }
    if (request.url === '/interrupt' && request.method === 'POST') {
      interrupted = true;
      response.end('{}');
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const client = new ComfyUIClient(
    {
      baseUrl: `http://127.0.0.1:${address.port}`,
      clientId: 'memory-guard-test',
      minimumFreeRamBytes: 100,
    },
    new FilmGameComfyWorkflowRegistry(),
  );

  try {
    await assert.rejects(
      client.runWorkflow(
        { test: { class_type: 'EmptyImage', inputs: {} } },
        {
          requestId: 'memory-guard-test',
          projectId: 'project-test',
          storyVersion: 1,
          idempotencyKey: 'memory-guard-test',
        },
      ),
      /below safety floor/,
    );
    assert.equal(interrupted, true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
