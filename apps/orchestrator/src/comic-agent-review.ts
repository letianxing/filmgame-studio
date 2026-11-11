import { validateAssemblySources } from './comic-video-assembly.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ComicService, ShotRun } from './comic-service.js';
import { cleanupRejected } from './comic-cleanup.js';

export const REVIEW_GATES = ['identity', 'scene_light', 'physical_action', 'story_causality', 'performance', 'audio', 'continuity', 'delivery'] as const;
export interface AgentReviewAuthorization { enabled: boolean; instruction: string; at: string; }
export interface AgentReviewInput {
  scope?: 'MEDIA' | 'STATIC_REFERENCE';
  runId: string; sha256: string; inputHash: string; decision: 'APPROVED' | 'REJECTED';
  reviewer: string; reason: string;
  gates: Record<string, 'PASS' | 'FAIL' | 'UNVERIFIED'>;
  evidence: Array<{ reference: string; sha256: string }>;
}
export interface AgentReviewEvidence {
  scope?: AgentReviewInput['scope'];
  reviewer: string; authorization: AgentReviewAuthorization;
  gates: AgentReviewInput['gates']; evidence: AgentReviewInput['evidence'];
}
const STATIC_GATES = ['identity', 'scene_light', 'physical_action', 'story_causality', 'continuity'] as const;
function validEvidence(a: AgentReviewEvidence | undefined, kind?: ShotRun['kind']) {
  const staticOnly = a?.scope === 'STATIC_REFERENCE';
  return !!a && a.authorization?.enabled === true && !!a.authorization.instruction?.trim()
    && (a.scope === undefined || a.scope === 'MEDIA' || (staticOnly && kind === 'REFERENCE'))
    && !!a.reviewer?.trim() && Array.isArray(a.evidence) && a.evidence.length > 0
    && a.evidence.every(e => typeof e.reference === 'string' && !!e.reference.trim() && /^[a-f0-9]{64}$/.test(e.sha256))
    && (staticOnly
      ? STATIC_GATES.every(g => a.gates?.[g] === 'PASS')
        && ['performance', 'audio', 'delivery'].every(g => a.gates?.[g] === 'UNVERIFIED')
      : REVIEW_GATES.every(g => a.gates?.[g] === 'PASS'));
}
export function acceptedReviewActor(r: ShotRun) {
  return r.reviewDecision?.actor === 'LOCAL_CREATOR'
    || (r.reviewDecision?.actor === 'AUTHORIZED_AGENT' && validEvidence(r.reviewDecision.agentReview, r.kind));
}
export async function configureAgentReview(service: ComicService, id: string, enabled: boolean, instruction: string) {
  if (typeof enabled !== 'boolean' || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2000)
    throw new Error('Explicit delegation instruction required');
  return service.exclusive(id, async p => {
    p.agentReviewAuthorization = { enabled, instruction: instruction.trim(), at: new Date().toISOString() };
    await service.save(p); return p;
  });
}
/** Records reviewer attestation, not automatic proof of visual quality. */
export async function recordAgentReview(service: ComicService, id: string, input: AgentReviewInput) {
  return service.exclusive(id, async p => {
    if (!p.agentReviewAuthorization?.enabled) throw new Error('Agent review is not delegated');
    const r = p.runs.find(r => r.id === input.runId);
    if (!r || r.status !== 'REVIEW' || !r.file || input.sha256 !== r.sha256 || input.inputHash !== r.inputHash)
      throw new Error('Exact pending media revision required; existing decisions are immutable here');
    if (!['APPROVED', 'REJECTED'].includes(input.decision) || typeof input.reason !== 'string' || !input.reason.trim()
      || input.reason.length > 2000 || typeof input.reviewer !== 'string' || !input.reviewer.trim())
      throw new Error('Decision, reviewer and reason required');
    if (input.scope !== undefined && input.scope !== 'MEDIA' && input.scope !== 'STATIC_REFERENCE')
      throw new Error('Unknown review scope');
    if (input.scope === 'STATIC_REFERENCE' && r.kind !== 'REFERENCE')
      throw new Error('Static reference review cannot approve video or audio media');
    const a = { scope: input.scope, reviewer: input.reviewer, authorization: { ...p.agentReviewAuthorization }, gates: input.gates, evidence: input.evidence };
    if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.some(e => !e.reference?.trim() || !/^[a-f0-9]{64}$/.test(e.sha256)))
      throw new Error('Evidence references and SHA256 required');
    if (!REVIEW_GATES.every(g => ['PASS','FAIL','UNVERIFIED'].includes(input.gates?.[g] ?? ''))) throw new Error('All review gates required');
    if (input.decision === 'APPROVED' && (!validEvidence(a, r.kind) || r.inputHash !== service.hash(p, r.shotId)))
      throw new Error('Approval requires current inputs and every gate PASS for media; static references require static gates PASS and performance/audio/delivery UNVERIFIED');
    const file = path.resolve(service.directory(id), r.file);
    if (path.dirname(file) !== path.resolve(service.directory(id)) || createHash('sha256').update(await readFile(file)).digest('hex') !== input.sha256)
      throw new Error('Media path or bytes changed');
    if (input.decision === 'APPROVED') await validateAssemblySources(service, p, r);
    // Character promotion requires a separately reviewed binding, never implicit mutation here.
    r.status = input.decision;
    r.reviewDecision = { decision: input.decision, sha256: input.sha256, inputHash: r.inputHash,
      at: new Date().toISOString(), actor: 'AUTHORIZED_AGENT', reason: input.reason.trim(), agentReview: a };
    if (input.decision === 'REJECTED') r.error = `Agent rejected: ${input.reason.trim()}`;
    await service.save(p);
    if (input.decision === 'REJECTED') await cleanupRejected(p, service.directory(id), () => service.save(p));
    return p;
  });
}
