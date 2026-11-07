import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService } from './comic-service.js';

/** Bind a user-accepted timbre sample, not an approved final performance. */
export async function bindVoiceReference(service: ComicService, id: string, input: {
  revision: number; shotId: string; characterId: string; data: Buffer; sha256: string;
  userFeedback: string; performanceDirection: string; ledger: string;
}) {
  if (!input.data.length || input.data.length > 2_000_000 ||
      createHash('sha256').update(input.data).digest('hex') !== input.sha256 ||
      !input.userFeedback.trim() || !input.performanceDirection.trim() || !input.ledger.trim())
    throw new Error('Exact audio SHA and explicit user feedback, direction and ledger required');
  return service.exclusive(id, async p => {
    service.assertIdle(p);
    if (p.revision !== input.revision) throw new Error('Project revision changed');
    const { shot, story } = service.shot(p, input.shotId);
    const character = story.characters.find(c => c.id === input.characterId);
    if (!character || !shot.characterIds.includes(character.id)) throw new Error('Voice character is not in this shot');
    const file = `voice-${input.sha256}.mp3`;
    const target = path.join(service.directory(id), file);
    let created = false;
    try {
      try { await writeFile(target, input.data, { flag: 'wx' }); created = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (createHash('sha256').update(await readFile(target)).digest('hex') !== input.sha256)
        throw new Error('Stored voice SHA changed');
      const probe = await service.config.media.probe(target);
      if (!probe.streams?.some(s => s.codec_type === 'audio') || probe.streams.some(s => s.codec_type === 'video'))
        throw new Error('Audio-only reference required');
    } catch (e) { if (created) await unlink(target); throw e; }
    const role = `${character.name}音色参考；仅此角色使用。${input.performanceDirection}`;
    const reference = { nodeId: '', file, sha256: input.sha256, mediaType: 'audio' as const, role,
      voiceReview: { characterId: character.id, userFeedback: input.userFeedback,
        performanceDirection: input.performanceDirection, ledger: input.ledger,
        scope: 'TIMBRE_DIRECTION_ONLY' as const, finalPerformanceApproved: false as const } };
    p.shotReferences ??= {};
    const current = p.shotReferences[input.shotId] ?? [];
    if (current.some(r => r.mediaType === 'audio' && !r.voiceReview))
      throw new Error('Unattributed audio reference must be reviewed before replacement');
    // Preserve scene/video references and voices assigned to other characters.
    p.shotReferences[input.shotId] = [...current.filter(r =>
      r.mediaType !== 'audio' || r.voiceReview?.characterId !== character.id), reference];
    await service.save(p);
    return p;
  });
}
