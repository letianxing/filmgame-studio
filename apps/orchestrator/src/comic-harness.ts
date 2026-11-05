import type { ComicProject, ShotRun } from './comic-service.js';
import { billingSummary } from './comic-cost-ledger.js';

export interface HarnessPolicy {
  maxAttemptsPerShot: number;
  maxElapsedMinutesPerShot: number;
  providerWaitMinutes: number;
}

export const defaultHarnessPolicy: HarnessPolicy = {
  maxAttemptsPerShot: 3,
  maxElapsedMinutesPerShot: 90,
  providerWaitMinutes: 20,
};

export function validateHarnessPolicy(value: HarnessPolicy): HarnessPolicy {
  for (const key of Object.keys(defaultHarnessPolicy) as Array<keyof HarnessPolicy>) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 100_000)
      throw new Error(`Invalid harness policy: ${key}`);
  }
  return { ...value };
}

const active = new Set(['SUBMITTING', 'RUNNING', 'UNCERTAIN']);
function attempted(run: ShotRun): boolean {
  if (run.imported) return false; // Reuse is not a newly submitted paid attempt.
  return Boolean(run.submittedAt) || !['DRAFT', 'QUOTED'].includes(run.status);
}

export function submissionGate(project: ComicProject, run: ShotRun, now = Date.now()): string[] {
  const policy = project.harnessPolicy ?? defaultHarnessPolicy;
  const history = project.runs.filter(r => r.shotId === run.shotId && r.id !== run.id && attempted(r));
  const issues: string[] = [];
  if (history.some(r => active.has(r.status))) issues.push('同一镜头仍有运行或状态不确定的任务；先核对原任务');
  if (history.length >= policy.maxAttemptsPerShot) issues.push(`该镜头已尝试 ${history.length} 次，需明确调整制作限额或方案`);
  const starts = history.map(r => Date.parse(r.submittedAt ?? r.createdAt)).filter(Number.isFinite);
  if (starts.length && now - Math.min(...starts) >= policy.maxElapsedMinutesPerShot * 60_000)
    issues.push('该镜头已达到累计墙钟耗时上限；需要人工决定后续方案');
  return issues;
}

/** Read-only projection: waiting is never approval, and age is never proof of failure. */
export function harnessProgress(project: ComicProject, current: (run: ShotRun) => boolean, now = Date.now()) {
  const policy = project.harnessPolicy ?? defaultHarnessPolicy;
  const shotIds = project.story?.episodes.flatMap(e => e.shots.map(s => s.id)) ?? [];
  const valid = project.runs.filter(current);
  const approved = shotIds.filter(id => valid.some(r => r.shotId === id && r.status === 'APPROVED'));
  const generated = shotIds.filter(id => valid.some(r => r.shotId === id && ['REVIEW', 'APPROVED'].includes(r.status)));
  const review = valid.filter(r => r.status === 'REVIEW').map(r => ({
    key: `${r.id}:${r.sha256 ?? 'unverified'}`,
    runId: r.id, shotId: r.shotId, sha256: r.sha256 ?? null,
    kind: r.kind === 'REFERENCE' ? 'CONCEPT' : 'VIDEO',
    file: r.file ?? null,
    imported: r.imported ?? null,
    acknowledged: r.reviewAcknowledgedSha === r.sha256 && Boolean(r.sha256),
    basicReview: r.basicReview?.sha256 === r.sha256 ? r.basicReview : null,
    manualChecks: r.kind === 'REFERENCE'
      ? ['人物身份、服饰、时代与既有定妆一致', '确认正侧面、体型及道具，可作为后续镜头真源']
      : ['原速看完整动作：支撑、接触、惯用手和起止姿态', '对照上下镜：人物、场景、光向和空间关系', '核对配音读音、情绪、口型、音乐与音效', '确认叙事信息和节奏，不把技术通过当作审美通过'],
  }));
  const tasks = project.runs.map(r => {
    const start = Date.parse(r.submittedAt ?? r.createdAt);
    const end = Date.parse(r.completedAt ?? '') || now;
    const elapsedMinutes = Number.isFinite(start) ? Math.max(0, (end - start) / 60_000) : null;
    const needsAttention = active.has(r.status) && elapsedMinutes !== null && elapsedMinutes >= policy.providerWaitMinutes;
    return { runId: r.id, shotId: r.shotId, status: r.status, elapsedMinutes,
      needsAttention, reason: needsAttention ? '等待超过提醒阈值；核对原任务，禁止自动重提' : r.error ?? null,
      estimatedCredits: r.credits ?? null, reservedCeiling: r.creditCeiling ?? null,
      actualCredits: null, stale: !current(r) };
  });
  const ledger = [billingSummary(project, 'DREAMINA_CREDIT'), billingSummary(project, 'CNY')];
  const plannedSeconds = project.story?.episodes.reduce((sum, e) => sum + e.shots.reduce((n, s) => n + s.durationSeconds, 0), 0) ?? 0;
  const acceptedSeconds = project.story?.episodes.reduce((sum, e) => sum + e.shots.filter(s => approved.includes(s.id)).reduce((n, s) => n + s.durationSeconds, 0), 0) ?? 0;
  return { policy, plannedSeconds, acceptedSeconds, totalShots: shotIds.length, generatedShots: generated.length,
    humanApprovedShots: approved.length, runtimeIntegratedShots: null, runtimeVerifiedShots: null,
    review, tasks, ledger, budget: { unit: 'DREAMINA_CREDIT', ceiling: project.creditBudget?.ceiling ?? null,
      cnyCeiling: project.currencyBudget?.ceiling ?? null, auxiliaryReserved: project.creditBudget?.auxiliaryReserved ?? 0,
      committedCeiling: ledger[0]!.committed,
      actualSettled: null, note: '保守占用上限，不是实际消费；未确认退款不释放。火山费用独立核算。' } };
}
