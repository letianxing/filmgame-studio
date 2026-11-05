import type { ComicProject } from './comic-service.js';

export type BillingUnit = 'DREAMINA_CREDIT' | 'CNY';
export interface BillingReceipt {
  receiptId: string;
  runId: string;
  unit: BillingUnit;
  kind: 'FINAL_CHARGE' | 'CONFIRMED_REFUND';
  amount: number;
  evidence: string;
  recordedAt: string;
  source: 'CREATOR_CONFIRMED';
}

function minor(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1e9 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-5)
    throw new Error('费用必须为非负金额，最多两位小数');
  return Math.round(value * 100);
}

export function addBillingReceipt(project: ComicProject, input: Omit<BillingReceipt, 'recordedAt' | 'source'>): boolean {
  if (!input || !['FINAL_CHARGE', 'CONFIRMED_REFUND'].includes(input.kind)) throw new Error('账单类型无效');
  if (typeof input.receiptId !== 'string' || !input.receiptId.trim() || input.receiptId.length > 200
    || typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 2000)
    throw new Error('需要唯一账单编号和可核对的账单凭据说明');
  const amount = minor(input.amount);
  const run = project.runs.find(r => r.id === input.runId);
  if (!run || input.unit !== (run.provider === 'dreamina' ? 'DREAMINA_CREDIT' : 'CNY'))
    throw new Error('任务或费用单位不匹配，人民币和积分不可混账');
  const receipts = project.billingReceipts ?? [];
  const duplicate = receipts.find(r => r.receiptId === input.receiptId && r.unit === input.unit);
  if (duplicate) {
    if (duplicate.runId === input.runId && duplicate.kind === input.kind && duplicate.amount === input.amount && duplicate.evidence === input.evidence) return false;
    throw new Error('同一账单编号内容冲突');
  }
  const charge = receipts.find(r => r.runId === input.runId && r.kind === 'FINAL_CHARGE');
  if (input.kind === 'FINAL_CHARGE') {
    if (charge) throw new Error('任务已有最终扣费账单，不能重复入账');
    if (!['REVIEW', 'APPROVED', 'REJECTED', 'FAILED'].includes(run.status))
      throw new Error('任务尚未终态，不能释放其在途预留');
  } else {
    if (!charge) throw new Error('先确认最终扣费，再登记退款');
    const refunded = receipts.filter(r => r.runId === input.runId && r.kind === 'CONFIRMED_REFUND').reduce((sum, r) => sum + minor(r.amount), 0);
    if (refunded + amount > minor(charge.amount)) throw new Error('累计退款不能超过已确认扣费');
  }
  project.billingReceipts = [...receipts, { ...input, recordedAt: new Date().toISOString(), source: 'CREATOR_CONFIRMED' }];
  return true;
}

export function billingSummary(project: ComicProject, unit: BillingUnit, excludingRunId?: string) {
  const receipts = (project.billingReceipts ?? []).filter(r => r.unit === unit && r.runId !== excludingRunId);
  let reserved = unit === 'DREAMINA_CREDIT' ? minor(project.creditBudget?.auxiliaryReserved ?? 0) : 0;
  let unknownReservations = 0;
  for (const r of project.runs) {
    if (r.id === excludingRunId || (r.provider === 'dreamina' ? 'DREAMINA_CREDIT' : 'CNY') !== unit
      || ['DRAFT', 'QUOTED'].includes(r.status)) continue;
    if (receipts.some(receipt => receipt.runId === r.id && receipt.kind === 'FINAL_CHARGE')) continue;
    const ceiling = unit === 'DREAMINA_CREDIT' ? r.creditCeiling ?? r.credits : r.currencyCeiling;
    if (ceiling === undefined) unknownReservations++;
    else reserved += minor(ceiling);
  }
  const charged = receipts.filter(r => r.kind === 'FINAL_CHARGE').reduce((sum, r) => sum + minor(r.amount), 0);
  const refunded = receipts.filter(r => r.kind === 'CONFIRMED_REFUND').reduce((sum, r) => sum + minor(r.amount), 0);
  return { unit, reserved: reserved / 100, charged: charged / 100, refunded: refunded / 100,
    committed: (reserved + charged - refunded) / 100, unknownReservations, confirmedReceiptCount: receipts.length };
}
