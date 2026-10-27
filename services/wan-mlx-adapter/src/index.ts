import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProviderError, type VideoProvider, type VideoGenerationRequest, type ProviderContext, type ProviderHealth, type ProviderResult, type GeneratedAsset } from '@filmgame/provider-sdk';

export type WanMlxProfile = '5b' | '14b-lightning-evaluation';
export interface WanMlxConfig { pythonPath: string; workerPath: string; modelDir: string; hfHome: string; outputDir: string; timeoutMs?: number; steps?: number; profile?: WanMlxProfile; lightningDir?: string }
export function validateMlxWanRequest(request: VideoGenerationRequest, profile: WanMlxProfile = '5b'): { image: string; frames: number; fps: number } {
  if (!['5b', '14b-lightning-evaluation'].includes(profile)) throw new Error('Unsupported Wan profile');
  if (request.generateAudio || request.referenceVideoUris?.length || request.referenceAssetUris.length || request.lastFrameUri) throw new Error('Wan MLX requires one composed first frame; native audio/video-reference/last-frame constraints are unsupported');
  if (!Number.isFinite(request.durationSeconds) || request.durationSeconds <= 0 || request.durationSeconds > 4) throw new Error('Wan safe profile supports at most4seconds');
  if (!request.firstFrameUri || !request.firstFrameUri.startsWith('file:')) throw new Error('Wan MLX requires a local composed first frame');
  const workflow = profile === '5b' ? 'wan2-2-ti2v-5b-v1' : 'wan2-2-i2v-14b-lightning-evaluation-v1';
  if (request.workflowId && request.workflowId !== workflow) throw new Error('Unsupported Wan workflow for selected profile');
  if (profile !== '5b' && request.aspectRatio && request.aspectRatio !== '16:9') throw new Error('14B evaluation requires landscape');
  const fps = profile === '5b' ? 24 : 16;
  return { image: fileURLToPath(request.firstFrameUri), frames: Math.max(5, Math.ceil((request.durationSeconds*fps-1)/4)*4+1), fps };
}

export class WanMlxVideoProvider implements VideoProvider {
  readonly id = 'local-wan-mlx'; readonly kind = 'VIDEO' as const;
  constructor(readonly config: WanMlxConfig) {}
  async health(): Promise<ProviderHealth> {
    try {
      const profile = this.config.profile ?? '5b';
      if (!['5b', '14b-lightning-evaluation'].includes(profile)) throw new Error('Unsupported Wan profile');
      const model = JSON.parse(await readFile(path.join(this.config.modelDir, 'config.json'), 'utf8'));
      const dual = profile === '14b-lightning-evaluation';
      if (dual ? !(model.dual_model === true && model.model_type === 'i2v' && model.dim === 5120 && model.in_dim === 36 && model.num_layers === 40 && model.quantization?.bits === 4 && model.quantization?.group_size === 64) : (model.dual_model || model.in_dim !== 48)) throw new Error('Model does not match selected profile');
      if (dual && (!this.config.lightningDir || (this.config.steps ?? 4) !== 4)) throw new Error('14B Lightning requires LoRA and four steps');
      const weights = dual ? ['high_noise_model.safetensors', 'low_noise_model.safetensors'] : ['model.safetensors'];
      const loras = dual ? weights.map(n => path.join(this.config.lightningDir!, n)) : [];
      for (const file of [this.config.pythonPath, this.config.workerPath, ...['config.json',...weights,'t5_encoder.safetensors','vae.safetensors'].map((n) => path.join(this.config.modelDir,n)), ...loras]) {
        if (!(await stat(file)).isFile()) throw new Error('Required local file missing');
      }
      return { status: 'HEALTHY', checkedAt: new Date().toISOString() };
    } catch { return { status: 'UNAVAILABLE', checkedAt: new Date().toISOString(), message: 'Local Wan MLX runtime or model files are incomplete' }; }
  }
  async generateVideo(request: VideoGenerationRequest, context: ProviderContext): Promise<ProviderResult<GeneratedAsset>> {
    const profile = this.config.profile ?? '5b';
    const { image, frames, fps } = validateMlxWanRequest(request, profile);
    const evaluationOnly = profile === '14b-lightning-evaluation';
    const steps = this.config.steps ?? (evaluationOnly ? 4 : 20);
    context.signal?.throwIfAborted();
    if ((await stat(image)).size > 20*1024**2) throw new Error('First frame exceeds20MB');
    if ((await this.health()).status !== 'HEALTHY') throw new ProviderError(this.id,'UNAVAILABLE','Local Wan MLX is not installed',false);
    const startedAt = new Date().toISOString();
    const name = createHash('sha256').update(JSON.stringify({ request, key: context.idempotencyKey, model: this.config.modelDir, profile, lightningDir: this.config.lightningDir, steps })).digest('hex');
    const work = path.join(this.config.outputDir,name); await mkdir(work,{recursive:true});
    const output = path.join(work,'video.mp4'); const partial = path.join(work,'video.partial.mp4');
    const payload = { modelDir: this.config.modelDir, hfHome: this.config.hfHome, image, prompt: request.prompt,
      negativePrompt: request.negativePrompt ?? 'distorted anatomy, duplicate people, extra limbs, oversaturation, flicker, text, subtitles, watermark', width: request.aspectRatio === '9:16' ? 288 : 512,
      height: request.aspectRatio === '9:16' ? 512 : 288, frames, steps,
      ...(evaluationOnly ? { evaluationOnly: true, lightningDir: this.config.lightningDir } : {}),
      seed: request.seed ?? 208, output: partial };
    const requestFile = path.join(work,'request.json'); await writeFile(requestFile,JSON.stringify(payload),{mode:0o600});
    // No automatic retry/fallback. The Python wrapper owns the resource lock and model-child lifetime.
    let tail = '';
    await new Promise<void>((resolve,reject) => {
      const child = spawn(this.config.pythonPath,[this.config.workerPath,requestFile],{shell:false,stdio:['ignore','pipe','pipe']});
      const record = (chunk: Buffer) => { tail = (tail+chunk.toString()).slice(-32768); };
      child.stdout.on('data',record); child.stderr.on('data',record);
      const abort = () => child.kill('SIGTERM');
      context.signal?.addEventListener('abort',abort,{once:true});
      if (context.signal?.aborted) abort();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; abort(); },this.config.timeoutMs ?? 30*60_000);
      child.once('error',(error) => { clearTimeout(timer);context.signal?.removeEventListener('abort',abort);reject(error); });
      child.once('close',(code) => {
        clearTimeout(timer);context.signal?.removeEventListener('abort',abort);
        if(context.signal?.aborted) reject(context.signal.reason);
        else if(timedOut) reject(new Error('Local Wan MLX timed out'));
        else if(code !== 0) reject(new ProviderError(this.id,'INVALID_RESPONSE',`Local Wan MLX stopped: ${tail.slice(-4000)}`,false));
        else resolve();
      });
    }).finally(async () => { await writeFile(path.join(work,'worker.log'),tail,{mode:0o600}); });
    if (!(await stat(partial)).size) throw new Error('Wan MLX produced an empty video');
    const { rename } = await import('node:fs/promises'); await rename(partial,output);
    const resources = JSON.parse(await readFile(partial+'.resources.json','utf8'));
    return { provider:this.id, model:evaluationOnly ? 'Wan2.2-I2V-A14B-MLX-q4-Lightning-evaluation' : 'Wan2.2-TI2V-5B-MLX-q8', requestId:context.requestId, startedAt,
      completedAt:new Date().toISOString(), data:{temporaryUri:pathToFileURL(output).href,mimeType:'video/mp4'},
      usage:[{unit:'SECONDS',input:0,output:frames/fps}],metadata:{workflowId:evaluationOnly ? 'wan2-2-i2v-14b-lightning-evaluation-v1' : 'wan2-2-ti2v-5b-mlx-q8-safe-v1',frames,fps,evaluationOnly,nativeAudio:false,peakRssMb:resources.peakRssMb} };
  }
}
