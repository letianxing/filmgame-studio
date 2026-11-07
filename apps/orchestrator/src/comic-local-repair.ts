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
