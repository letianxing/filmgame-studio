/** Offline import; never constructs a paid provider. Run while this project is idle. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ComicService } from '../apps/orchestrator/src/comic-service.js';
import { importComicCandidate } from '../apps/orchestrator/src/comic-import.js';
import { MediaPipeline } from '../services/media-pipeline/src/index.js';
import { validateComic, type ComicStory, type Ratio } from '../packages/comic-engine/src/index.js';

const filename = process.argv[2];
if (!filename) throw new Error('Usage: tsx scripts/import-comic-candidates.ts plan.json');
const raw = await readFile(filename, 'utf8');
const plan = JSON.parse(raw) as {
  root: string; story: ComicStory; ratio: Ratio; credits: number;
  candidates: Array<Omit<Parameters<typeof importComicCandidate>[1], 'projectId'>>;
};
validateComic(plan.story);
const digest = createHash('sha256').update(raw).digest('hex');
const receiptPath = `${filename}.receipt.json`;
const service = new ComicService({ root: path.resolve(plan.root), llm: null, video: null, dreamina: null,
  media: new MediaPipeline({ ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg', ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe' }) });
let receipt: { planSha256: string; projectId: string; imported: string[] };
try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  const project = await service.create({ idea: plan.story.logline, style: plan.story.visualStyle, ratio: plan.ratio,
    episodeCount: plan.story.episodes.length, episodeSeconds: 180 });
  receipt = { planSha256: digest, projectId: project.id, imported: [] };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
}
if (receipt.planSha256 !== digest) throw new Error('Import plan changed; review the existing receipt before continuing');
let project = await service.get(receipt.projectId);
if (!project.story) project = await service.apply(project.id, plan.story, project.revision);
if (JSON.stringify(project.story) !== JSON.stringify(plan.story)) throw new Error('Existing project story differs from import plan');
if (!project.creditBudget) await service.configureBudgets(project.id, { credits: plan.credits, auxiliaryReserved: 0, cny: 0 });
for (const candidate of plan.candidates) {
  const current = await importComicCandidate(service, { ...candidate, projectId: project.id });
  if (!receipt.imported.includes(candidate.shotId)) receipt.imported.push(candidate.shotId);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  const run = current.runs.find(r => r.shotId === candidate.shotId && r.imported?.sourceSha256 === candidate.expectedSha256);
  console.log(JSON.stringify({ projectId: project.id, shot: candidate.shotId, state: run?.status, newGenerationCost: 0 }));
}
