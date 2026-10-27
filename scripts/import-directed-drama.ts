/** Import a reviewed, locally rendered director sample into the existing Creator Console asset contract. */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DramaStore, type DramaRecord } from '../apps/orchestrator/src/drama-store.js';
import { validateDirectedDrama } from '../apps/orchestrator/src/directed-drama.js';
import { dramaContent, validateDrama } from '@filmgame/story-engine';
import { MediaPipeline } from '@filmgame/media-pipeline';
import type { DramaDocument } from '@filmgame/shared-types';

const arg = (name: string) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`); return process.argv[index + 1]!; };
const folder = path.resolve(arg('--folder')); const ownerId = arg('--owner');

const castFile = process.argv.includes('--characters') ? arg('--characters') : undefined;
const cast: Array<{ id: string; name: string; appearance: string }> = castFile
  ? JSON.parse(await readFile(path.resolve(castFile), 'utf8'))
  : [{ id: 'commander', name: '将军', appearance: '原创青年将军，暗红披风。' }, { id: 'scout', name: '斥候', appearance: '原创中年斥候，灰褐衣。' }];
const speakerIds = new Map(cast.map((c) => [c.name, c.id]));

const plan: unknown = JSON.parse(await readFile(path.join(folder, 'director-plan.json'), 'utf8')); validateDirectedDrama(plan);
const videoPath = path.resolve(arg('--video')); const subtitlePath = path.resolve(arg('--subtitles'));
const media = new MediaPipeline({ ffmpegPath: process.env.FFMPEG_PATH ?? '', ffprobePath: process.env.FFPROBE_PATH ?? '' });
const qa = await media.validateTechnical(videoPath, { requireAudio: true, requireVideo: true, expectedAspectRatio: 16 / 9 });
if (!qa.valid || !qa.durationSeconds) throw new Error(`Movie technical QA failed: ${JSON.stringify(qa)}`);
const store = new DramaStore(path.resolve(process.env.DRAMA_STORAGE_ROOT || '.local/drama')); await store.init();
const id = `drama-${randomUUID()}`; const now = new Date().toISOString();
const document: DramaDocument = { schemaVersion: '1.0.0', projectId: id, version: 1, parentVersion: null,
  title: plan.title, visualStyle: plan.style, aspectRatio: plan.aspectRatio,
  characters: cast.map((c) => ({ ...c, voiceId: '', voiceReferenceAssetId: '', referenceImageAssetId: '', referenceTranscript: '', rightsConfirmed: false })),
  episodes: [{ id: 'episode-directed', title: plan.title, shots: plan.segments.flatMap((segment) => segment.shots.map((shot) => ({
    id: shot.id, description: `${shot.visual} 叙事目的：${shot.purpose}`, camera: shot.camera, durationSeconds: Math.ceil(shot.end - shot.start),
    characterIds: cast.map((c) => c.id), dialogue: segment.dialogue.filter((line) => line.start >= shot.start && line.start < shot.end)
      .map((line) => { const characterId = speakerIds.get(line.speaker); if (!characterId) throw new Error(`Unbound speaker: ${line.speaker}`); return { characterId, text: line.text }; }),
  }))) }],
};
validateDrama(dramaContent(document));
const video = await store.put(createReadStream(videoPath), 'video/mp4');
const subtitles = await store.put(createReadStream(subtitlePath), 'text/vtt');
const directorPlan = await store.put(Buffer.from(JSON.stringify(plan)), 'application/json');
const record: DramaRecord = { id, ownerId, idea: `${plan.fictionNotice} 原生音画导演样片，待创作者审片。后续使用普通 TTS 制作模式前需单独绑定声音。`,
  createdAt: now, updatedAt: now, status: 'READY', document, history: [structuredClone(document)],
  assets: { [video.id]: video, [subtitles.id]: subtitles, [directorPlan.id]: directorPlan }, renders: [{
    id: `run-${randomUUID()}`, version: 1, mode: 'VIDEO', status: 'COMPLETED', completed: plan.segments.length, total: plan.segments.length,
    message: '导演审片版：原生对白与环境声、实测字幕时间、统一响度。人物与场景连续性请结合审查报告和实际成片验收。',
    shots: {}, episodes: [{ id: 'episode-directed', title: plan.title, video: video.id, subtitle: subtitles.id, duration: qa.durationSeconds, burnedSubtitles: true }],
  }] };
for (const segment of plan.segments) {
  const receipt = JSON.parse(await readFile(path.join(folder, 'raw', `${segment.id}.receipt.json`), 'utf8'));
  const raw = await store.put(createReadStream(path.join(folder, 'raw', `${segment.id}.mp4`)), 'video/mp4'); record.assets[raw.id] = raw;
  (record.generations ??= []).push({ assetId: raw.id, provider: receipt.provider, model: receipt.model, requestId: receipt.requestId,
    inputHash: receipt.planHash, createdAt: receipt.completedAt, usage: receipt.usage ?? [] });
}
await store.save(record);
await writeFile(path.join(folder, 'console-import.json'), JSON.stringify({ projectId: id, url: `http://localhost:3000/drama?projectId=${id}`,
  sha256: video.sha256, duration: qa.durationSeconds }, null, 2));
console.log(`Imported ${id}; http://localhost:3000/drama?projectId=${id}`);
