import assert from 'node:assert/strict';
import test from 'node:test';
import { addBillingReceipt, billingSummary } from '../src/comic-cost-ledger.js';
import type { ComicProject } from '../src/comic-service.js';

function fixture(): ComicProject {
  return { id: 'p', title: '', idea: '', style: '', ratio: '16:9', episodeCount: 1, episodeSeconds: 20,
    revision: 1, storyVersion: 1, createdAt: '', updatedAt: '', phase: '', references: {}, exports: [],
    runs: [{ id: 'r', shotId: 's', provider: 'dreamina', status: 'FAILED', creditCeiling: 30, storyVersion: 1, inputHash: 'h', createdAt: '' }] };
}
const receipt = { receiptId: 'bill1', runId: 'r', unit: 'DREAMINA_CREDIT' as const, kind: 'FINAL_CHARGE' as const, amount: 20, evidence: 'Provider final bill #1 checked' };
test('failed or uncertain tasks retain reserves until confirmed final accounting', () => {
  const p = fixture(); assert.equal(billingSummary(p, 'DREAMINA_CREDIT').reserved, 30);
  p.runs[0]!.status = 'UNCERTAIN';
  assert.throws(() => addBillingReceipt(p, receipt), /终态/);
  assert.equal(billingSummary(p, 'DREAMINA_CREDIT').reserved, 30);
  p.runs[0]!.status = 'FAILED';
  addBillingReceipt(p, receipt);
  assert.equal(billingSummary(p, 'DREAMINA_CREDIT').reserved, 0);
  assert.equal(billingSummary(p, 'DREAMINA_CREDIT').committed, 20);
});
test('duplicate receipts are idempotent, conflicts and excessive refunds rejected', () => {
  const p = fixture(); assert.equal(addBillingReceipt(p, receipt), true);
  assert.equal(addBillingReceipt(p, receipt), false);
  assert.throws(() => addBillingReceipt(p, { ...receipt, amount: 21 }), /冲突/);
  addBillingReceipt(p, { ...receipt, receiptId: 'refund1', kind: 'CONFIRMED_REFUND', amount: 5 });
  assert.equal(billingSummary(p, 'DREAMINA_CREDIT').committed, 15);
  assert.throws(() => addBillingReceipt(p, { ...receipt, receiptId: 'refund2', kind: 'CONFIRMED_REFUND', amount: 16 }), /超过/);
});
test('units cannot mix and unknown reservations never become free', () => {
  const p = fixture(); assert.throws(() => addBillingReceipt(p, { ...receipt, unit: 'CNY' }), /单位/);
  delete p.runs[0]!.creditCeiling;
  assert.equal(billingSummary(p, 'DREAMINA_CREDIT').unknownReservations, 1);
  assert.equal(billingSummary(p, 'CNY').unknownReservations, 0);
  assert.throws(() => addBillingReceipt(p, { ...receipt, amount: NaN }), /费用/);
  assert.throws(() => addBillingReceipt(p, { ...receipt, amount: 0.001 }), /费用/);
});
