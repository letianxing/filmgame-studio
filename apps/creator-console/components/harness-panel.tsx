'use client';

// Raw generated review candidates may have no captions yet; never fabricate a caption track.
/* eslint-disable jsx-a11y/media-has-caption */

import { useEffect, useRef, useState } from 'react';
import type { harnessProgress } from '../../orchestrator/src/comic-harness';

type Progress = ReturnType<typeof harnessProgress>;

export function HarnessPanel({ progress, asset, action, disabled }: {
  progress: Progress;
  asset: (file: string) => string;
  action: (name: string, body: unknown) => Promise<unknown>;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const shown = useRef(new Set<string>());
  const pending = progress.review.filter(r => !r.acknowledged);
  useEffect(() => {
    if (pending.some(r => !shown.current.has(r.key))) {
      pending.forEach(r => shown.current.add(r.key));
      if (!dialog.current?.open) dialog.current?.showModal();
    }
  }, [pending]);
  async function send(name: string, body: unknown) {
    setSaving(true); setError('');
    try { await action(name, body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  const locked = disabled || saving;
  return <section aria-label="制作控制台" style={{ border: '1px solid #52605b', padding: 16, borderRadius: 12, marginBottom: 20 }}>
    <h2>制作进度与待审</h2>
    <p>先审概念与关键帧，再生成短镜头；优先复用已采纳素材。复杂动作先做最短可验片段，通过后扩展时长。模型选择以实际报价和样片为准。</p>
    <p>已生成 {progress.generatedShots}/{progress.totalShots} · 人工采纳 {progress.humanApprovedShots}/{progress.totalShots} · 待审 {progress.review.length}</p>
    <p>计划片长 {progress.plannedSeconds} 秒 · 已采纳 {progress.acceptedSeconds} 秒</p>
    <p>即梦累计额度上限 {progress.budget.ceiling ?? '未设置'} · 累计报价及预留占用 {progress.budget.committedCeiling} 积分</p>
    <p>这是本项目的累计账本，包含历史任务，不是单个节点预算，也不是账户实时余额。报价占用不代表实际扣费。</p>
    {progress.ledger.map(row => <p key={row.unit}>{row.unit === 'CNY' ? '火山人民币' : '即梦积分'}：预留 {row.reserved} · 已确认扣费 {row.charged} · 已确认退款 {row.refunded} · 待核对金额的任务 {row.unknownReservations}</p>)}
    <small>{progress.budget.note} Runtime 接入/验收尚未回传。</small>
    <p><button type="button" onClick={() => dialog.current?.showModal()}>打开审片队列（{progress.review.length}）</button></p>
    <button disabled={locked} onClick={() => void send('cleanup-rejected', {})}>清理无依赖的拒收素材</button>
    <details><summary>制作边界与任务耗时</summary>
      <form key={JSON.stringify(progress.budget)} onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void send('budgets', { credits: Number(f.get('credits')), auxiliaryReserved: Number(f.get('auxiliary')), cny: Number(f.get('cny')) });
      }}>
        <label>即梦累计额度上限（含历史占用，积分）<input name="credits" type="number" min="0" step="1" required defaultValue={progress.budget.ceiling ?? 0} /></label>
        <label>其他素材预留（积分）<input name="auxiliary" type="number" min="0" step="1" required defaultValue={progress.budget.auxiliaryReserved} /></label>
        <label>火山项目总额（元）<input name="cny" type="number" min="0" step="0.01" required defaultValue={progress.budget.cnyCeiling ?? 0} /></label>
        <button disabled={locked}>保存项目预算</button>
      </form>
      <p>上限覆盖历史任务的报价占用及素材预留，并非钱包剩余额度。新余额需与历史占用核对后再填写，不能直接把钱包余额填作累计上限；不自动充值。</p>
      <form key={JSON.stringify(progress.policy)} onSubmit={e => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        void send('harness-policy', { policy: {
          maxAttemptsPerShot: Number(form.get('attempts')),
          maxElapsedMinutesPerShot: Number(form.get('elapsed')),
          providerWaitMinutes: Number(form.get('waiting')),
        } });
      }}>
        <label>每镜头尝试上限 <input name="attempts" type="number" min="1" max="100000" defaultValue={progress.policy.maxAttemptsPerShot} required /></label>
        <label>累计耗时上限（分钟） <input name="elapsed" type="number" min="1" max="100000" defaultValue={progress.policy.maxElapsedMinutesPerShot} required /></label>
        <label>供应商等待提醒（分钟） <input name="waiting" type="number" min="1" max="100000" defaultValue={progress.policy.providerWaitMinutes} required /></label>
        <button disabled={locked}>保存边界</button>
      </form>
      <p>达到边界后停止新提交，等待你调整方案。不会终止或复制供应商现有任务。</p>
      <ul>{progress.tasks.map(t => <li key={t.runId}>{t.shotId} · {t.status}{t.stale ? ' · 旧版本' : ''} · {t.elapsedMinutes === null ? '耗时未知' : `${Math.floor(t.elapsedMinutes)} 分钟`} {t.reason}</li>)}</ul>
    </details>
    <details><summary>登记已核对的账单或退款</summary>
      <p>仅填写供应商已确认的最终账单，不能将预计退款当作可用额度。金额由你核对后登记，系统不会伪称供应商自动核验。</p>
      <form onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void send('billing-receipt', { receipt: { runId: f.get('runId'), unit: f.get('unit'),
          receiptId: f.get('receiptId'), kind: f.get('kind'), amount: Number(f.get('amount')), evidence: f.get('evidence') } });
      }}>
        <label>任务<select name="runId" required>{progress.tasks.map(t => <option key={t.runId} value={t.runId}>{t.shotId} · {t.runId} · {t.status}</option>)}</select></label>
        <label>单位<select name="unit"><option value="DREAMINA_CREDIT">即梦积分</option><option value="CNY">火山人民币</option></select></label>
        <label>类型<select name="kind"><option value="FINAL_CHARGE">最终扣费</option><option value="CONFIRMED_REFUND">确认退款</option></select></label>
        <label>金额<input name="amount" type="number" min="0" step="0.01" required /></label>
        <label>账单/退款唯一编号<input name="receiptId" maxLength={200} required /></label>
        <label>核对凭据说明<input name="evidence" maxLength={2000} required /></label>
        <button disabled={locked || !progress.tasks.length}>记录已确认账单</button>
      </form>
    </details>
    {error && <p role="alert">{error}</p>}
    <dialog ref={dialog} aria-label="人工审片" style={{ margin: 'auto', padding: 24, borderRadius: 14, border: '1px solid #665e4f', background: '#171d23', color: '#e8ebee', maxWidth: 900, width: '85vw', maxHeight: '85vh', overflow: 'auto' }}>
      {error && <p role="alert">{error}</p>}
      <h2>需要你审片</h2><p>请核对下方基础检查证据；人物、表演、物理和电影感仍需你判断。关闭窗口不代表采纳。</p>
      <button onClick={() => dialog.current?.close()}>暂时关闭</button>
      {progress.review.length === 0 && <p>当前没有待审候选。</p>}
      {progress.review.map(r => <article key={r.key} style={{ borderTop: '1px solid #888', padding: 12 }}>
        <h3>{r.shotId} · {r.kind === 'CONCEPT' ? '概念定妆' : '视频候选'}</h3>
        {r.file && (r.kind === 'CONCEPT'
          // Native img intentionally avoids proxying local, versioned review assets.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={asset(r.file)} alt={`${r.shotId} 待审参考`} style={{ maxWidth: '100%', maxHeight: 400 }} />
          : <video controls preload="none" src={asset(r.file)} style={{ width: '100%', maxHeight: 400 }} />)}
        <p>版本 SHA：{r.sha256 ?? '缺失，不能确认'}</p>
        {r.imported && <p>复用历史候选：{r.imported.sourceLabel}。历史费用保留在来源账本，本次导入不产生生成费用；尚未经你的采纳。</p>}
        <p>{r.basicReview ? `基础检查：${r.basicReview.checkedAt}（仅技术项）` : '尚无可追溯的基础审核报告，请勿把旧状态当作完整检查。'}</p>
        {r.kind !== 'CONCEPT' && !r.basicReview?.signals && <p>黑场/静音分析未完成，请人工核对。</p>}{r.basicReview && <ul>{[...r.basicReview.technical.issues, ...(r.basicReview.signals?.issues ?? [])].map((issue, i) => <li key={`${issue.code}-${i}`}>{issue.severity} · {issue.message}</li>)}</ul>}
        <ul>{r.manualChecks.map(check => <li key={check}>{check}</li>)}</ul>
        <button disabled={locked || !r.sha256} onClick={() => void send('approve', { runId: r.runId, sha256: r.sha256 })}>采纳此版本</button>
        <button disabled={locked || !r.sha256} onClick={() => void send('acknowledge-review', { runId: r.runId, sha256: r.sha256 })}>已知晓，稍后审核</button>
        <label>定点返工说明（时间码、问题、期望改善）<textarea value={reasons[r.key] ?? ''} maxLength={2000} onChange={e => setReasons({ ...reasons, [r.key]: e.target.value })} /></label>
        <button disabled={locked || !r.sha256 || !reasons[r.key]?.trim()} onClick={() => void send('reject-review', { runId: r.runId, sha256: r.sha256, reason: reasons[r.key] })}>拒收并清理无依赖文件</button>
      </article>)}
    </dialog>
  </section>;
}
