import { createHash, randomUUID } from 'node:crypto';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService } from './comic-service.js';

/** Bind only the exact human-adopted bytes; upload is performed by prepare. */
export async function bindReferenceCandidate(service: ComicService, id: string, runId: string, sha256: string, targetShotId?: string) {
  return service.exclusive(id, async p => {
    service.assertIdle(p);
    const r = p.runs.find(r => r.id === runId);
    if (!r || r.kind !== 'REFERENCE' || r.status !== 'APPROVED' || !r.file ||
        r.sha256 !== sha256 || r.reviewDecision?.sha256 !== sha256 ||
        r.reviewDecision.decision !== 'APPROVED' || r.reviewDecision.actor !== 'LOCAL_CREATOR')
      throw new Error('Exact human-adopted reference required');
    if (createHash('sha256').update(await readFile(path.join(service.directory(id), r.file))).digest('hex') !== sha256)
      throw new Error('Reference SHA changed');
    const shotId = targetShotId ?? r.shotId;
    if (!p.story?.episodes.some(e => e.shots.some(s => s.id === shotId)))
      throw new Error('Target shot does not exist');
    if (shotId !== r.shotId && !r.shotId.startsWith('scene:'))
      throw new Error('Only a scene reference can be bound to another shot');
    if (r.shotId.startsWith('scene:') && r.inputHash !== service.hash(p, r.shotId))
      throw new Error('Reference context changed before binding');
    const current = p.shotReferences?.[shotId];
    if (current?.length === 1 && current[0]?.file === r.file) return p;
    if (r.inputHash !== service.hash(p, r.shotId)) throw new Error('Reference context changed before binding');
    p.shotReferences ??= {};
    p.shotReferences[shotId] = [{ nodeId: '', file: r.file, sha256, mediaType: 'image',
      role: 'Exact human-adopted composition, character identities, anatomical pose and lighting; preserve these in motion.' }];
    await service.save(p);
    return p;
  });
}

/** Exact-byte external keyframe review. Never binds or approves the reference automatically. */
export async function importReferenceCandidate(service: ComicService, id: string, input: {
  revision: number; shotId: string; data: Buffer; sha256: string; sourceLabel: string; ledger: string;
}) {
  if (!input.sourceLabel.trim() || !input.ledger.trim() || input.data.length > 5_000_000 ||
      !input.data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      createHash('sha256').update(input.data).digest('hex') !== input.sha256)
    throw new Error('参考图须为5MB以内PNG，并提供正确SHA、来源及费用账本');
  return service.exclusive(id, async p => {
    service.assertIdle(p);
    if (p.revision !== input.revision) throw new Error('项目版本已变化，请刷新');
    service.shot(p, input.shotId);
    const inputHash = service.hash(p, input.shotId);
    const existing = p.runs.find(r => r.kind === 'REFERENCE' && r.shotId === input.shotId &&
      r.inputHash === inputHash && r.sha256 === input.sha256);
    if (existing) {
      if (!existing.file || createHash('sha256').update(await readFile(path.join(service.directory(id), existing.file))).digest('hex') !== input.sha256)
        throw new Error('Existing reference SHA mismatch');
      return p;
    }
    if (p.runs.some(r => r.shotId === input.shotId && r.status === 'REVIEW' && r.inputHash === inputHash))
      throw new Error('本镜头仍有待审核候选');
    const runId = randomUUID(), file = `${runId}.png`;
    const target = path.join(service.directory(id), file);
    await writeFile(target, input.data, { flag: 'wx' });
    try {
      const probe = await service.config.media.probe(target);
      const stream = probe.streams?.find(s => s.codec_type === 'video');
      const width = Number(stream?.width), height = Number(stream?.height);
      const [w,h] = p.ratio.split(':').map(Number);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 256 || height < 256 ||
          Math.abs(width / height - w! / h!) > 0.03) throw new Error('参考图尺寸或比例不符');
    } catch (error) { await unlink(target); throw error; }
    const now = new Date().toISOString();
    p.runs.push({ id: runId, shotId: input.shotId, kind: 'REFERENCE', provider: 'external',
      status: 'REVIEW', storyVersion: p.storyVersion, inputHash, file, sha256: input.sha256,
      createdAt: now, completedAt: now,
      imported: { sourceSha256: input.sha256, sourceLabel: input.sourceLabel, importedAt: now,
        billing: 'HISTORICAL_EXTERNAL_LEDGER', ledger: input.ledger },
      basicReview: { sha256: input.sha256, checkedAt: now, technical: { valid: true, issues: [] }, scope: 'TECHNICAL_ONLY' } });
    p.phase = '外部构图待人工审核';
    await service.save(p);
    return p;
  });
}
