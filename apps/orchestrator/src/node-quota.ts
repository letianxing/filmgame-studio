/** Planning estimate, never a provider quote, debit, refund or approval. */
export interface QuotaTask {
  assetId: string;
  category: 'story' | 'choice' | 'loop' | 'battle' | 'concept' | 'audio';
  units: number;
  creditsPerUnit?: number;
  priceEvidence?: string;
  reused?: boolean;
}
export function estimateNodeQuota(tasks: QuotaTask[], priorReserved: number, repairReserveRatio: number) {
  if (!Number.isFinite(priorReserved) || priorReserved < 0 || !Number.isFinite(repairReserveRatio)
    || repairReserveRatio < 0 || repairReserveRatio > 1) throw new Error('Invalid quota parameters');
  const unique = new Map<string, QuotaTask>();
  for (const task of tasks) {
    if (!task.assetId || !Number.isFinite(task.units) || task.units < 0
      || (task.creditsPerUnit !== undefined && (!Number.isFinite(task.creditsPerUnit) || task.creditsPerUnit < 0)))
      throw new Error('Invalid asset estimate');
    const previous = unique.get(task.assetId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(task)) throw new Error(`Conflicting reused asset: ${task.assetId}`);
    unique.set(task.assetId, task);
  }
  const lines = [...unique.values()].map(task => ({ ...task,
    estimatedCredits: task.reused ? 0 : task.creditsPerUnit !== undefined && task.priceEvidence?.trim()
      ? Math.ceil(task.units * task.creditsPerUnit) : null }));
  const knownNewCredits = lines.reduce((sum, line) => sum + (line.estimatedCredits ?? 0), 0);
  const repairReserve = Math.ceil(knownNewCredits * repairReserveRatio);
  const unpricedAssets = lines.filter(line => line.estimatedCredits === null).map(line => line.assetId);
  return { scope: 'ESTIMATE_NOT_QUOTE_OR_AUTHORIZATION', lines, priorReserved, knownNewCredits, repairReserve,
    knownTotalWithReserve: priorReserved + knownNewCredits + repairReserve,
    complete: unpricedAssets.length === 0, unpricedAssets,
    note: 'Shared asset IDs count once. Unpriced items are unknown, not free. Requote each submission; refunds need evidence.' };
}
