import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService } from './comic-service.js';

export interface VideoDerivativeInput {
  revision: number; sourceRunId: string; sourceSha256: string; targetInputHash: string;
  data: Buffer; sha256: string; editDescription: string; ledger: string; durationSeconds: number;
  sourceInterval?: { startSeconds: number; endSeconds: number } | undefined;
}
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Single-shot editorial derivative: never inherits approval or alters its source. */
export async function importVideoDerivative(service: ComicService, id: string, input: VideoDerivativeInput) {
  if (!Buffer.isBuffer(input.data) || input.data.length > 30_000_000 || input.data.length < 12 ||
      input.data.toString('ascii', 4, 8) !== 'ftyp' || digest(input.data) !== input.sha256 ||
      typeof input.editDescription !== 'string' || !input.editDescription.trim() || input.editDescription.length > 4000 ||
      typeof input.ledger !== 'string' || !input.ledger.trim() || input.ledger.length > 1000 ||
      !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 120)
    throw new Error('Provide bounded MP4 bytes, exact SHA, editorial rationale, ledger and measured duration');
  return service.exclusive(id, async p => {
    service.assertIdle(p);
    if (p.revision !== input.revision) throw new Error('Project revision changed');
    const source = p.runs.find(r => r.id === input.sourceRunId);
    if (!source || source.kind || !source.file || !['REVIEW','APPROVED'].includes(source.status) ||
        source.sha256 !== input.sourceSha256 || source.inputHash !== input.targetInputHash ||
        service.hash(p, source.shotId) !== input.targetInputHash)
      throw new Error('Current non-rejected source video and exact input SHA required');
    if (input.sourceInterval) {
      const t = input.sourceInterval;
      if (!Number.isFinite(t.startSeconds) || !Number.isFinite(t.endSeconds) || t.startSeconds < 0 ||
          t.endSeconds <= t.startSeconds || !source.durationSeconds || t.endSeconds > source.durationSeconds ||
          Math.abs(input.durationSeconds - (t.endSeconds - t.startSeconds)) > .12)
        throw new Error('Source interval must be bounded and match derivative duration');
    }
    const sourceFile = path.resolve(service.directory(id), source.file);
    if (path.dirname(sourceFile) !== path.resolve(service.directory(id)) ||
        digest(await readFile(sourceFile)) !== input.sourceSha256)
      throw new Error('Source path or bytes changed');
    if (input.sha256 === input.sourceSha256) throw new Error('Derivative must differ from source');
    const existing = p.runs.find(r => r.derivative?.sourceRunId === source.id &&
      r.inputHash === input.targetInputHash && r.sha256 === input.sha256);
    if (existing) {
      if (JSON.stringify(existing.derivative?.sourceInterval) !== JSON.stringify(input.sourceInterval))
        throw new Error('Existing derivative interval provenance differs');
      if (!existing.file || digest(await readFile(path.join(service.directory(id), existing.file))) !== input.sha256)
        throw new Error('Existing derivative unavailable; do not resurrect rejected candidates');
      return p;
    }
    const runId = randomUUID(), file = `${runId}.mp4`, target = path.join(service.directory(id), file);
    await writeFile(target, input.data, { flag: 'wx' });
    try {
      const [w,h] = p.ratio.split(':').map(Number);
      const technical = await service.config.media.validateTechnical(target, {
        requireVideo: true, requireAudio: true, expectedAspectRatio: w! / h!,
        expectedDurationSeconds: input.durationSeconds, durationToleranceSeconds: .1,
      });
      if (!technical.valid || !technical.durationSeconds) throw new Error('Imported video failed technical validation');
      const now = new Date().toISOString();
      p.runs.push({ id: runId, shotId: source.shotId, provider: 'external', status: 'REVIEW',
        storyVersion: p.storyVersion, inputHash: input.targetInputHash, file, sha256: input.sha256,
        durationSeconds: technical.durationSeconds, createdAt: now, completedAt: now,
        derivative: { sourceRunId: source.id, sourceSha256: input.sourceSha256,
          editDescription: input.editDescription.trim(), ledger: input.ledger.trim(), ...(input.sourceInterval ? { sourceInterval: { ...input.sourceInterval } } : {}) },
        basicReview: { sha256: input.sha256, checkedAt: now, technical, scope: 'TECHNICAL_ONLY' } });
      p.phase = '本地修整视频待审核';
      await service.save(p);
      return p;
    } catch (error) { await unlink(target); throw error; }
  });
}
