import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService } from './comic-service.js';

/** Planning tools, not claims that experimental local renderers are production-ready. */
export const localRepairCapabilities = [
  { id: 'image-local-edit', media: 'image', maturity: 'REFERENCE_REVIEW', tools: ['imagegen', 'dreamina'], checks: ['edit scope', 'identity', 'lighting', 'geometry'], automatedExecution: false },
  { id: 'video-tracked-patch', media: 'video', maturity: 'EXPERIMENTAL', tools: ['OpenCV SIFT', 'DIS optical flow', 'FFmpeg'], checks: ['moving occlusions', 'disocclusion', 'temporal edges', 'original PTS', 'audio packets', 'cut continuity'], automatedExecution: false },
  { id: 'video-shot-regeneration', media: 'video', maturity: 'PROVIDER_QUOTE_REQUIRED', tools: ['dreamina'], checks: ['approved references', 'fresh quote', 'camera and action continuity', 'original edit conform'], automatedExecution: false },
] as const;

export interface LocalRepairPlan {
  id: string; sourceRunId: string; sourceSha256: string; shotId: string;
  method: string; defect: string; region: string; preserve: string[];
  interval?: { startSeconds: number; endSeconds: number };
  limits: { maxCredits: number; maxMinutes: number; maxAttempts: number };
  createdAt: string; status: 'PLANNED_NOT_EXECUTED';
  checks: string[]; actualCredits: null; actualCostCny: null;
  humanApproved: false; runtimePromoted: false; userDirection: string;
}
export interface LocalRepairInput {
  revision: number; runId: string; sha256: string; method: string; defect: string;
  region: string; preserve: string[]; userDirection: string;
  interval?: { startSeconds: number; endSeconds: number };
  limits: LocalRepairPlan['limits'];
}

/** Bind a defective movie as motion evidence, never as adopted appearance or delivery. */
export async function bindRepairSource(service: ComicService, id: string, input: {
  revision: number; planId: string; targetInputHash: string; targetShotId?: string | undefined; clipRunId?: string | undefined;
}) {
  return service.exclusive(id, async p => {
    service.assertIdle(p);
    if (p.revision !== input.revision) throw new Error('Project revision changed');
    const plan = p.localRepairPlans?.find(x => x.id === input.planId);
    if (!plan || plan.method !== 'video-shot-regeneration' || plan.status !== 'PLANNED_NOT_EXECUTED')
      throw new Error('Video regeneration plan required');
    const targetShotId = input.targetShotId ?? plan.shotId;
    const { shot: targetShot } = service.shot(p, targetShotId);
    if (service.hash(p, targetShotId) !== input.targetInputHash) throw new Error('Target input changed');
    const source = p.runs.find(r => r.id === plan.sourceRunId);
    if (!source || source.kind === 'REFERENCE' || source.shotId !== plan.shotId || !source.file ||
        source.sha256 !== plan.sourceSha256 || !['REVIEW', 'APPROVED'].includes(source.status))
      throw new Error('Exact available repair source required');
    const root = path.resolve(service.directory(id)), file = path.resolve(root, source.file);
    if (path.dirname(file) !== root) throw new Error('Source must be project-local media');
    if (createHash('sha256').update(await readFile(file)).digest('hex') !== plan.sourceSha256)
      throw new Error('Source SHA changed');
    let reference = source;
    const interval = plan.interval!;
    const partial = interval.startSeconds > 0 || Math.abs(interval.endSeconds - source.durationSeconds!) > .12;
    if (partial && !input.clipRunId) throw new Error('Partial repair requires a bounded derivative clip');
    if (input.clipRunId) {
      const clip = p.runs.find(r => r.id === input.clipRunId);
      const t = clip?.derivative?.sourceInterval;
      if (!clip || clip.kind || !clip.file || !clip.sha256 || !['REVIEW','APPROVED'].includes(clip.status) ||
          clip.shotId !== source.shotId || clip.derivative?.sourceRunId !== source.id ||
          clip.derivative?.sourceSha256 !== source.sha256 || !t ||
          t.startSeconds !== interval.startSeconds || t.endSeconds !== interval.endSeconds ||
          !clip.durationSeconds || Math.abs(clip.durationSeconds - (t.endSeconds - t.startSeconds)) > .12)
        throw new Error('Exact interval derivative required');
      const clipFile = path.resolve(root, clip.file);
      if (path.dirname(clipFile) !== root || createHash('sha256').update(await readFile(clipFile)).digest('hex') !== clip.sha256)
        throw new Error('Clip path or SHA changed');
      if (targetShot.durationSeconds < clip.durationSeconds - .12 || targetShot.durationSeconds > Math.ceil(clip.durationSeconds) + .12)
        throw new Error('Target duration must match repair clip, not the full source');
      reference = clip;
    }
    const refs = p.shotReferences?.[targetShotId] ?? [];
    if (!refs.some(r => r.mediaType === 'image')) throw new Error('Bind corrected image references first');
    // Replace only an earlier repair source; preserve existing image/audio guidance.
    const kept = refs.filter(r => !r.role.startsWith('REPAIR_SOURCE_NOT_APPROVED:'));
    p.shotReferences ??= {};
    p.shotReferences[targetShotId] = [...kept, { nodeId: '', file: reference.file!,
      sha256: reference.sha256!, mediaType: 'video',
      role: `REPAIR_SOURCE_NOT_APPROVED: plan=${plan.id}; source=${source.id}; interval=${interval.startSeconds}-${interval.endSeconds}; clip=${reference.id}; motion/camera evidence only. ` +
        `Correct: ${plan.defect}. Preserve: ${plan.preserve.join('; ')}. ` +
        'Use corrected image references for identity; do not reproduce the source defect. This is not approved delivery media.' }];
    await service.save(p);
    return p;
  });
}

export async function planLocalRepair(service: ComicService, id: string, input: LocalRepairInput) {
  const capability=localRepairCapabilities.find(c=>c.id===input.method);
  const nonempty=(s: unknown): s is string=>typeof s==='string' && s.trim().length>0 && s.length<=4000;
  if (!capability || !nonempty(input.defect) || !nonempty(input.region) || !nonempty(input.userDirection)
      || !Array.isArray(input.preserve) || input.preserve.length===0 || input.preserve.length>30 || !input.preserve.every(nonempty))
    throw new Error('Repair method, localized defect/region, preservation constraints and user direction required');
  const limits=input.limits;
  if (!limits || !Number.isFinite(limits.maxCredits) || limits.maxCredits<0 ||
      !Number.isFinite(limits.maxMinutes) || limits.maxMinutes<=0 ||
      !Number.isInteger(limits.maxAttempts) || limits.maxAttempts<1)
    throw new Error('Explicit finite repair limits required');
  return service.exclusive(id,async p=>{
    service.assertIdle(p);
    if(p.revision!==input.revision) throw new Error('Project revision changed');
    const source=p.runs.find(r=>r.id===input.runId);
    if(!source?.file || !source.sha256 || source.sha256!==input.sha256 ||
       !['APPROVED','REVIEW','REJECTED'].includes(source.status)) throw new Error('Exact available source revision required');
    const root=path.resolve(service.directory(id));const file=path.resolve(root,source.file);
    if(path.dirname(file)!==root) throw new Error('Source must be project-local media');
    if(createHash('sha256').update(await readFile(file)).digest('hex')!==source.sha256) throw new Error('Source SHA changed');
    const media=source.kind==='REFERENCE'?'image':'video';
    if(capability.media!==media) throw new Error('Repair method does not match source media');
    if(media==='video') {
      const t=input.interval;
      if(!t || !Number.isFinite(t.startSeconds) || !Number.isFinite(t.endSeconds) || t.startSeconds<0 ||
          t.endSeconds<=t.startSeconds || !source.durationSeconds || t.endSeconds>source.durationSeconds)
        throw new Error('Explicit bounded video interval required');
    } else if(input.interval) throw new Error('Image repair has no video interval');
    const plan:LocalRepairPlan={id:randomUUID(),sourceRunId:source.id,sourceSha256:source.sha256,shotId:source.shotId,
      method:input.method,defect:input.defect.trim(),region:input.region.trim(),preserve:[...input.preserve],
      ...(input.interval?{interval:{...input.interval}}:{}),limits:{...limits},createdAt:new Date().toISOString(),
      status:'PLANNED_NOT_EXECUTED',checks:[...capability.checks,'exact candidate human review'],
      actualCredits:null,actualCostCny:null,humanApproved:false,runtimePromoted:false,userDirection:input.userDirection.trim()};
    p.localRepairPlans??=[];p.localRepairPlans.push(plan);
    await service.save(p);
    return {project:p,plan};
  });
}
