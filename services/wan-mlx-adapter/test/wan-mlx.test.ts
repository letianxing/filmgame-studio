import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMlxWanRequest, WanMlxVideoProvider } from '../src/index.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const base = { prompt: 'A man turns his head', durationSeconds: 2, firstFrameUri: 'file:///owned/frame.jpg', referenceAssetUris: [] };
test('MLX Wan validates local first-frame and bounded generation before spawning', () => {
  assert.equal(validateMlxWanRequest(base).frames, 49);
  const { firstFrameUri: _frame, ...missingFrame } = base;
  assert.throws(() => validateMlxWanRequest(missingFrame));
  for (const patch of [{ generateAudio: true }, { durationSeconds: 5 }, { firstFrameUri: 'https://example.com/frame.jpg' },
    { referenceAssetUris: ['file:///uncomposed-sheet.jpg'] }, { lastFrameUri: 'file:///last.png' }]) {
    assert.throws(() => validateMlxWanRequest({ ...base, ...patch }));
  }
});
test('14B evaluation uses its own frame rate and rejects a mismatched workflow or portrait', () => {
  assert.equal(validateMlxWanRequest(base, '14b-lightning-evaluation').frames, 33);
  assert.equal(validateMlxWanRequest(base, '14b-lightning-evaluation').fps, 16);
  assert.equal(validateMlxWanRequest({...base, durationSeconds: 4}, '14b-lightning-evaluation').frames, 65);
  assert.equal(validateMlxWanRequest({...base, durationSeconds: .01}).frames, 5);
  assert.throws(() => validateMlxWanRequest({...base, workflowId: 'wan2-2-ti2v-5b-v1'}, '14b-lightning-evaluation'));
  assert.throws(() => validateMlxWanRequest({...base, aspectRatio: '9:16'}, '14b-lightning-evaluation'));
});
test('14B admission requires matching model config, both model halves, LoRA and four steps', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wan-admission-'));
  try {
    const lightningDir = path.join(dir, 'lightning'); await mkdir(lightningDir);
    for (const name of ['python','worker','high_noise_model.safetensors','low_noise_model.safetensors','t5_encoder.safetensors','vae.safetensors']) await writeFile(path.join(dir,name), 'fixture');
    await writeFile(path.join(dir,'config.json'), JSON.stringify({dual_model:true,model_type:'i2v',dim:5120,in_dim:36,num_layers:40,quantization:{bits:4,group_size:64}}));
    const config = {pythonPath:path.join(dir,'python'),workerPath:path.join(dir,'worker'),modelDir:dir,hfHome:dir,outputDir:dir,profile:'14b-lightning-evaluation' as const,lightningDir};
    assert.equal((await new WanMlxVideoProvider(config).health()).status, 'UNAVAILABLE');
    for (const name of ['high_noise_model.safetensors','low_noise_model.safetensors']) await writeFile(path.join(lightningDir,name), 'fixture');
    assert.equal((await new WanMlxVideoProvider(config).health()).status, 'HEALTHY');
    assert.equal((await new WanMlxVideoProvider({...config,steps:20}).health()).status, 'UNAVAILABLE');
    assert.equal((await new WanMlxVideoProvider({...config,profile:'5b'}).health()).status, 'UNAVAILABLE');
    await rm(path.join(dir,'low_noise_model.safetensors'));
    assert.equal((await new WanMlxVideoProvider(config).health()).status, 'UNAVAILABLE');
  } finally { await rm(dir, {recursive:true,force:true}); }
});
