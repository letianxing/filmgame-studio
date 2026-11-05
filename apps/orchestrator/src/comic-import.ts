import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService } from './comic-service.js';

async function sha(file: string) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

/** Local operator-only bridge. No HTTP endpoint accepts arbitrary disk paths. */
export async function importComicCandidate(service: ComicService, input: {
  projectId: string; shotId: string; source: string; expectedSha256: string;
  sourceLabel: string; historicalLedger: string; provider: 'dreamina' | 'seedance';
  /** Silent atmosphere/choice loops are valid; dialogue clips still require audio. */
  audioPolicy?: 'REQUIRED' | 'RUNTIME_MIX';
}) {
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256) || !input.sourceLabel.trim() || !input.historicalLedger.trim())
    throw new Error('Import requires source SHA, identity and historical cost ledger');
  return service.exclusive(input.projectId, async p => {
    service.assertIdle(p);
    const { shot } = service.shot(p, input.shotId);
    if (input.audioPolicy === 'RUNTIME_MIX' && shot.dialogue.length)
      throw new Error('Dialogue clips require audio; runtime mix is only for non-dialogue media');
    const source = path.resolve(input.source);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || path.extname(source).toLowerCase() !== '.mp4')
      throw new Error('Import requires a regular MP4');
    if (await sha(source) !== input.expectedSha256) throw new Error('Import source SHA mismatch');
    const inputHash = service.hash(p, input.shotId);
    const existing = p.runs.find(r => r.shotId === input.shotId && r.inputHash === inputHash
      && r.imported?.sourceSha256 === input.expectedSha256);
    if (existing) {
      if (!existing.file || await sha(path.join(service.directory(p.id), existing.file)) !== existing.sha256)
        throw new Error('Prior import was removed or changed; do not silently recreate it');
      return p;
    }
    const id = randomUUID(); const file = `${id}.mp4`;
    const root = await realpath(service.directory(p.id));
    const target = path.resolve(root, file);
    if (path.dirname(target) !== root) throw new Error('Import destination escaped project');
    await copyFile(source, target, 1); // COPYFILE_EXCL, never overwrite an existing candidate.
    try {
      if (await sha(target) !== input.expectedSha256) throw new Error('Import changed during copy');
      const [w, h] = p.ratio.split(':').map(Number);
      const technical = await service.config.media.validateTechnical(target, {
        requireVideo: true, requireAudio: input.audioPolicy !== 'RUNTIME_MIX', expectedAspectRatio: w! / h!,
      });
      if (!technical.valid) throw new Error(`Import technical check: ${technical.issues.map(i => i.message).join('; ')}`);
      const now = new Date().toISOString();
      p.runs.push({ id, shotId: input.shotId, provider: input.provider, status: 'REVIEW',
        storyVersion: p.storyVersion, inputHash, file, sha256: input.expectedSha256,
        createdAt: now, completedAt: now,
        ...(technical.durationSeconds !== undefined ? { durationSeconds: technical.durationSeconds } : {}),
        imported: { sourceSha256: input.expectedSha256, sourceLabel: input.sourceLabel,
          importedAt: now, billing: 'HISTORICAL_EXTERNAL_LEDGER', ledger: input.historicalLedger },
        basicReview: { sha256: input.expectedSha256, checkedAt: now, technical, scope: 'TECHNICAL_ONLY' },
      });
    } catch (error) { await unlink(target); throw error; }
    // Save failure deliberately preserves the verified copy; no deletion after uncertain persistence.
    p.phase = '历史候选待人工审核';
    await service.save(p);
    return p;
  });
}
