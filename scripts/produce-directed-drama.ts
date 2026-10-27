/** Bounded, resumable director-plan execution through FilmGame's existing VideoProvider. */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RemoteVideoProvider } from '@filmgame/remote-video-adapter';
import { RemoteStorageProvider } from '@filmgame/remote-storage-adapter';
import { MediaPipeline } from '@filmgame/media-pipeline';
import { validateDirectedDrama } from '../apps/orchestrator/src/directed-drama.js';

const run = promisify(execFile);
const arg = (name: string) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`); return process.argv[index + 1]!; };
const output = path.resolve(arg('--output'));
const optionalArg = (name: string) => process.argv.includes(name) ? arg(name) : undefined;
const only = optionalArg('--segment');
if (optionalArg('--backend') !== 'SEEDANCE') throw new Error('Specify --backend SEEDANCE for paid native-audio takes. For WAN use produce-local-wan.ts with a composed first frame; never silently route local requests to cloud.');
const ceiling = Number(optionalArg('--budget-cny') ?? '0');
const continueScene = process.argv.includes('--continue-scene');
const providerReference = process.argv.includes('--provider-reference');
const videoOnlyReference = process.argv.includes('--video-only-reference');
const plan: unknown = JSON.parse(await readFile(path.resolve(arg('--plan')), 'utf8'));
validateDirectedDrama(plan);
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Configure ${name}`); return value; };
const ffmpeg = required('FFMPEG_PATH');
const media = new MediaPipeline({ ffmpegPath: ffmpeg, ffprobePath: required('FFPROBE_PATH') });
const provider = new RemoteVideoProvider({ baseUrl: required('REMOTE_VIDEO_BASE_URL'), model: required('REMOTE_VIDEO_MODEL'),
  ...(process.env.REMOTE_VIDEO_API_TOKEN ? { token: process.env.REMOTE_VIDEO_API_TOKEN } : {}), timeoutMs: 45 * 60_000, pollIntervalMs: 5000 });
await mkdir(path.join(output, 'raw'), { recursive: true });
const references = await Promise.all(plan.referenceImages.map(async (file) => {
  const bytes = await readFile(path.join(output, file));
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Reference image exceeds 2 MB');
  return { uri: `data:${file.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${bytes.toString('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const planHash = createHash('sha256').update(JSON.stringify({ plan, references: references.map((r) => r.sha256) })).digest('hex');
await writeFile(path.join(output, 'director-plan.json'), JSON.stringify(plan, null, 2));

for (const segment of plan.segments) {
  if (only && segment.id !== only) continue;
  const filename = path.join(output, 'raw', `${segment.id}.mp4`);
  const receiptPath = path.join(output, 'raw', `${segment.id}.receipt.json`);
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as { planHash: string; sha256: string };
    if (receipt.planHash !== planHash) throw new Error('Input changed: choose a new output directory instead of overwriting a take');
    const bytes = await readFile(filename);
    if (createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) throw new Error('Existing take hash mismatch');
    console.log(`${segment.id}: reusing verified take`); continue;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const referenceVideoUris: string[] = [];
  const continuationImages: string[] = [];
  // Preserve the first accepted take's cast, not only whoever happens to occupy the latest tail frame.
  if (continueScene && !videoOnlyReference && segment.referenceSegments.length && plan.segments[0]) {
    const firstId = plan.segments[0].id;
    for (const seconds of [15, 22, 28]) {
      const image = path.join(output, 'references', `cast-from-${firstId}-${seconds}.jpg`);
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', path.join(output, 'raw', `${firstId}.mp4`),
        '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', image]);
      continuationImages.push(`data:image/jpeg;base64,${(await readFile(image)).toString('base64')}`);
    }
  }
  for (const sourceId of segment.referenceSegments) {
    const referencePath = path.join(output, 'references', `${sourceId}-reference.mp4`);
    await mkdir(path.dirname(referencePath), { recursive: true });
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...(continueScene ? ['-sseof', '-4'] : []), '-i', path.join(output, 'raw', `${sourceId}.mp4`), '-t', continueScene ? '4' : '12',
      '-vf', 'scale=640:-2', '-c:v', process.env.MEDIA_VIDEO_CODEC ?? 'libopenh264', '-b:v', '450k', '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+faststart', referencePath]);
    const bytes = await readFile(referencePath);
    if (bytes.length > 6 * 1024 * 1024) throw new Error('Video reference exceeds 6 MB');
    if (providerReference) {
      const receipt = JSON.parse(await readFile(path.join(output, 'raw', `${sourceId}.receipt.json`), 'utf8'));
      const statusResponse = await fetch(`${required('REMOTE_VIDEO_BASE_URL').replace(/\/$/, '')}/v1/video/generations/${receipt.metadata.generationId}`, {
        headers: { authorization: `Bearer ${required('REMOTE_VIDEO_API_TOKEN')}` }, signal: AbortSignal.timeout(15_000),
      });
      const status = await statusResponse.json() as { asset?: { temporaryUri?: string } };
      if (!statusResponse.ok || !status.asset?.temporaryUri?.startsWith('https://')) throw new Error('First take reference URL unavailable');
      referenceVideoUris.push(status.asset.temporaryUri);
    } else {
    const storage = new RemoteStorageProvider({ baseUrl: required('REMOTE_STORAGE_BASE_URL'),
      ...(process.env.REMOTE_STORAGE_API_TOKEN ? { token: process.env.REMOTE_STORAGE_API_TOKEN } : {}) });
    const digest = createHash('sha256').update(bytes).digest('hex');
    const key = `directed-drama/${plan.id}/references/${digest}.mp4`;
    await storage.put(key, bytes, 'video/mp4', { projectId: plan.id, storyVersion: 1, requestId: `${segment.id}:reference`, idempotencyKey: digest });
    referenceVideoUris.push(await storage.getSignedReadUri(key, 7200));
    }
    if (continueScene && !videoOnlyReference) {
      const last = path.join(output, 'references', `${sourceId}-last.jpg`);
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.1', '-i', referencePath, '-frames:v', '1', '-q:v', '3', last]);
      continuationImages.push(`data:image/jpeg;base64,${(await readFile(last)).toString('base64')}`);
    }
  }
  if (ceiling > 0) {
    let spent = 0;
    for (const previous of plan.segments) {
      try {
        const receipt = JSON.parse(await readFile(path.join(output, 'raw', `${previous.id}.receipt.json`), 'utf8'));
        spent += receipt.estimatedCostCny ?? (receipt.usage ?? []).reduce((sum: number, u: { unit: string; output: number }) => sum + (u.unit === 'TOKENS' ? u.output * 70 / 1e6 : 0), 0);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    // Reserve a conservative fixed amount for each bounded 30s 720p take, including input-video uncertainty.
    if (plan.resolution !== '720p' || segment.durationSeconds > 30 || spent + 60 > ceiling) throw new Error(`Budget admission denied: recorded=${spent.toFixed(2)}, reserve=60, ceiling=${ceiling}`);
    console.log(`Budget admission: recorded=${spent.toFixed(2)} CNY, reserved=60 CNY, ceiling=${ceiling}`);
  }
  console.log(`${segment.id}: submitting ${segment.durationSeconds}s ${plan.resolution}, native audio; bounded request ${plan.segments.indexOf(segment) + 1}/${plan.limits.maxInitialRequests}`);
  const started = Date.now();
  const progress = setInterval(() => console.log(`${segment.id}: waiting for provider (${Math.round((Date.now() - started) / 1000)}s)`), 30000);
  try {
    const extending = continueScene && referenceVideoUris.length > 0 && !providerReference;
    const anchors = `@图片${references.length + continuationImages.length}为上一段真实尾帧，控制这一段起始可见状态。@图片${references.length + 1}、@图片${references.length + 2}、@图片${references.length + 3}是第一段实际人物画面，分别约束孔明和鲁肃同框身份、孔明近景身份、张昭近景身份；沿用其实际衣帽、胡须与脸型，优先于文字外观描述。`;
    const prompt = extending ? `在 @视频1 的基础上续写${segment.durationSeconds}秒。${anchors}下列时间均指新增片段，从0秒重新计时。\n${segment.prompt}`
      : providerReference && referenceVideoUris.length ? `参考生成新的一段${segment.durationSeconds}秒视频，不是编辑或延长原视频。@视频1仅用于相同人物身份、原生音色和厅堂美术，不重复其中的旧动作和旧对白。${videoOnlyReference ? '人物面貌、衣帽和座次以@视频1实际画面为准，优先于下列文字造型描述。张昭位于正前方北端低案，孔明与鲁肃在中央走道。' : anchors}\n${segment.prompt.replace('上一段真实视频用于续写，继承其末尾的角色、空间与声音身份，从实际终点继续，绝不重放旧台词。', '使用实际视频中人物，在同一个厅堂继续新对白与动作；镜头可正常切换。')}` : segment.prompt;
    const result = await provider.generateVideo({ prompt, durationSeconds: segment.durationSeconds,
      resolution: plan.resolution, aspectRatio: extending ? 'adaptive' : plan.aspectRatio, generateAudio: true,
      referenceAssetUris: [...references.map((r) => r.uri), ...continuationImages], referenceVideoUris,
      ...(references.length || referenceVideoUris.length ? { omniReferenceTaskType: extending ? 'extend' as const : 'reference' as const } : {}),
    }, { projectId: plan.id, storyVersion: 1, requestId: `${plan.id}:${segment.id}`, idempotencyKey: `${plan.id}:${planHash}:${segment.id}`,
      signal: AbortSignal.timeout(45 * 60_000) });
    const response = await fetch(result.data.temporaryUri, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Provider asset download HTTP ${response.status}`);
    const temporary = `${filename}.partial`;
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(temporary));
    await rename(temporary, filename);
    if (extending) {
      const duration = Number((await media.probe(filename)).format?.duration);
      if (duration > segment.durationSeconds + 1) {
        if (duration > segment.durationSeconds + 6) throw new Error('Unexpected extension length; inspect before trimming');
        const full = path.join(output, 'raw', `${segment.id}-with-reference.mp4`);
        await rename(filename, full);
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(duration - segment.durationSeconds), '-i', full,
          '-t', String(segment.durationSeconds), '-c:v', process.env.MEDIA_VIDEO_CODEC ?? 'libopenh264', '-b:v', '6000k', '-c:a', 'aac', '-movflags', '+faststart', filename]);
      }
    }
    const qa = await media.validateTechnical(filename, { requireVideo: true, requireAudio: true,
      expectedAspectRatio: 16 / 9, expectedDurationSeconds: segment.durationSeconds, durationToleranceSeconds: 1 });
    if (!qa.valid) throw new Error(`Technical validation failed: ${JSON.stringify(qa.issues)}`);
    const sha256 = createHash('sha256').update(await readFile(filename)).digest('hex');
    await writeFile(receiptPath, JSON.stringify({ schemaVersion: '1.0.0', planHash, segmentId: segment.id, sha256,
      sizeBytes: (await stat(filename)).size, provider: result.provider, model: result.model, requestId: result.requestId,
      metadata: result.metadata, usage: result.usage,
      estimatedCostCny: (result.usage ?? []).reduce((sum, u) => sum + (u.unit === 'TOKENS' ? u.output * (referenceVideoUris.length ? 42 : 70) / 1e6 : 0), 0),
      execution: { mode: extending ? 'extend' : 'reference', referenceSeconds: providerReference && referenceVideoUris.length ? 30 : extending ? 4 : referenceVideoUris.length ? 12 : 0 },
      startedAt: result.startedAt, completedAt: result.completedAt, qa }, null, 2));
    console.log(`${segment.id}: downloaded, technical QA passed, duration=${qa.durationSeconds}, ${qa.video?.width}x${qa.video?.height}; usage=${JSON.stringify(result.usage)}`);
  } finally { clearInterval(progress); }
}
console.log('All requested takes downloaded. Editorial/visual/audio review is still required before delivery.');
