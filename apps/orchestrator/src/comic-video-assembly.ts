import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService, ComicProject, ShotRun } from './comic-service.js';
import { acceptedReviewActor } from './comic-agent-review.js';

export interface AssemblySource { runId: string; sha256: string; inputHash: string; }
export interface VideoAssembly {
  sources: AssemblySource[]; editDescription: string; ledger: string;
}
export interface AssemblyInput extends VideoAssembly {
  revision: number; targetShotId: string; targetInputHash: string;
  data: Buffer; sha256: string; durationSeconds: number;
}
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Follow all composite ancestry, including a later derivative of a composite. */
export async function validateAssemblySources(service: ComicService, p: ComicProject, run: ShotRun,
  requireApproval = true, ancestors = new Set<string>()): Promise<void> {
  if (ancestors.has(run.id)) throw new Error('Cyclic assembly provenance');
  const next = new Set(ancestors).add(run.id);
  const sources = run.assembly?.sources ?? [];
  for (const source of sources) {
    const r = p.runs.find(r => r.id === source.runId);
    if (!r || r.kind || !r.file || !['REVIEW', 'APPROVED'].includes(r.status) ||
        r.sha256 !== source.sha256 || r.inputHash !== source.inputHash || service.hash(p, r.shotId) !== source.inputHash)
      throw new Error('Assembly source is unavailable, rejected or stale');
    if (requireApproval && (r.status !== 'APPROVED' || !acceptedReviewActor(r) ||
        r.reviewDecision?.decision !== 'APPROVED' || r.reviewDecision.sha256 !== r.sha256 ||
        r.reviewDecision.inputHash !== r.inputHash)) throw new Error('Assembly source needs exact approval');
    const file = path.resolve(service.directory(p.id), r.file);
    if (path.dirname(file) !== path.resolve(service.directory(p.id)) || sha(await readFile(file)) !== source.sha256)
      throw new Error('Assembly source bytes changed');
    await validateAssemblySources(service, p, r, requireApproval, next);
  }
  if (run.derivative) {
    const parent = p.runs.find(r => r.id === run.derivative!.sourceRunId);
    if (parent) await validateAssemblySources(service, p, parent, requireApproval, next);
  }
}

/** Imports a local edit; neither component approval nor technical checks approve the edit. */
export async function importVideoAssembly(service: ComicService, id: string, input: AssemblyInput) {
  if (!Array.isArray(input.sources) || input.sources.length < 2 || input.sources.length > 32 ||
      input.sources.some(s => !s || typeof s.runId !== 'string' || !s.runId ||
        !/^[a-f0-9]{64}$/.test(s.sha256) || !/^[a-f0-9]{64}$/.test(s.inputHash)) ||
      !Buffer.isBuffer(input.data) || input.data.length < 12 || input.data.length > 30_000_000 ||
      input.data.toString('ascii', 4, 8) !== 'ftyp' || sha(input.data) !== input.sha256 ||
      typeof input.editDescription !== 'string' || !input.editDescription.trim() || input.editDescription.length > 4000 ||
      typeof input.ledger !== 'string' || !input.ledger.trim() || input.ledger.length > 1000 ||
      !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 120)
    throw new Error('Provide bounded assembly sources, MP4 bytes, SHA, duration and edit ledger');
  return service.exclusive(id, async p => {
    service.assertIdle(p);
    if (p.revision !== input.revision) throw new Error('Project revision changed');
    if (service.hash(p, input.targetShotId) !== input.targetInputHash) throw new Error('Target inputs changed');
    const assembly: VideoAssembly = { sources: input.sources.map(s => ({ runId: s.runId, sha256: s.sha256, inputHash: s.inputHash })),
      editDescription: input.editDescription.trim(), ledger: input.ledger.trim() };
    const now = new Date().toISOString(), runId = randomUUID(), file = `${runId}.mp4`;
    const run: ShotRun = { id: runId, shotId: input.targetShotId, provider: 'external', status: 'REVIEW',
      storyVersion: p.storyVersion, inputHash: input.targetInputHash, file, sha256: input.sha256,
      durationSeconds: input.durationSeconds, createdAt: now, completedAt: now, assembly };
    await validateAssemblySources(service, p, run, false);
    const existing = p.runs.find(r => r.assembly && r.shotId === run.shotId && r.sha256 === run.sha256 && r.inputHash === run.inputHash);
    if (existing) {
      if (JSON.stringify(existing.assembly) !== JSON.stringify(assembly)) throw new Error('Existing assembly provenance differs');
      if (!existing.file || !['REVIEW','APPROVED'].includes(existing.status) ||
          sha(await readFile(path.join(service.directory(id), existing.file))) !== input.sha256)
        throw new Error('Existing assembly unavailable; do not resurrect rejected media');
      return p;
    }
    const target = path.join(service.directory(id), file);
    await writeFile(target, input.data, { flag: 'wx' });
    try {
      const [w,h] = p.ratio.split(':').map(Number);
      const technical = await service.config.media.validateTechnical(target, { requireVideo: true, requireAudio: true,
        expectedAspectRatio: w! / h!, expectedDurationSeconds: input.durationSeconds, durationToleranceSeconds: .1 });
      if (!technical.valid || !technical.durationSeconds) throw new Error('Assembly failed technical validation');
      run.durationSeconds = technical.durationSeconds;
      run.basicReview = { sha256: input.sha256, checkedAt: now, technical, scope: 'TECHNICAL_ONLY' };
      p.runs.push(run);
      await service.save(p);
      return p;
    } catch (error) { await unlink(target); throw error; }
  });
}
