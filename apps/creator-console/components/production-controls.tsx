'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type ReviewJob = { id: string; type: string; output?: unknown; humanReview: { digest: string } };
type Payload = { status?: string; run?: { status?: string }; error?: string; detail?: unknown; reviewJobs?: ReviewJob[] };

export function ProductionControls({ projectId, initialStatus }: { projectId?: string; initialStatus?: string }) {
  const [status, setStatus] = useState(initialStatus ?? 'NOT_STARTED');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reviews, setReviews] = useState<ReviewJob[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = useRef(new Set<string>());
  const endpoint = `/api/projects/${encodeURIComponent(projectId ?? '')}/production`;
  async function request(method: string, body?: unknown): Promise<Payload> {
    const response = await fetch(endpoint, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const payload = await response.json() as Payload;
    if (!response.ok || payload.error) throw new Error(`${payload.error ?? response.status}${payload.detail ? ': ' + JSON.stringify(payload.detail) : ''}`);
    return payload;
  }
  function apply(payload: Payload) {
    const next = payload.run?.status ?? payload.status ?? 'UNKNOWN';
    setStatus(next); setReviews(payload.reviewJobs ?? []); return next;
  }
  useEffect(() => {
    if (!projectId || initialStatus === 'NOT_STARTED' || !initialStatus) return;
    let alive = true;
    fetch(endpoint, { method: 'PUT' }).then(async response => {
      const payload = await response.json() as Payload;
      if (alive) { if (!response.ok || payload.error) setMessage(payload.error ?? '同步失败'); else apply(payload); }
    }).catch(cause => { if (alive) setMessage(String(cause)); });
    return () => { alive = false; };
  }, [endpoint, projectId, initialStatus]);
  useEffect(() => {
    if (reviews.some(job => !shown.current.has(job.humanReview.digest))) {
      reviews.forEach(job => shown.current.add(job.humanReview.digest));
      if (!dialog.current?.open) dialog.current?.showModal();
    }
  }, [reviews]);
  async function perform(action: 'plan' | 'run' | 'sync') {
    setBusy(true); setMessage('');
    try {
      if (action === 'plan') await request('POST', { maxBudget: Number(budget), budgetCurrency: 'CNY' });
      if (action === 'run') await request('PATCH');
      for (let attempt = 0; attempt < 300; attempt++) {
        const next = apply(await request('PUT'));
        if (action === 'sync' || !['PLANNING', 'RUNNING', 'QUEUED'].includes(next)) return;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      setMessage('本页已停止轮询，后台状态保留。可稍后刷新，不会自动重提生成。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function review(job: ReviewJob, approve: boolean) {
    setBusy(true); setMessage('');
    try {
      await request('PATCH', { action: 'review', jobId: job.id, digest: job.humanReview.digest, approve, reason: reasons[job.id] });
      apply(await request('PUT'));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  if (!projectId) return <p>请先选择项目。</p>;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      {status === 'NOT_STARTED' && <><label>本次预算上限（人民币）<input aria-label="预算上限" type="number" min="0.01" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} /></label><Button disabled={busy || !(Number(budget) > 0)} onClick={() => void perform('plan')}>创建制作计划</Button></>}
      {['PLANNED', 'AWAITING_REVIEW'].includes(status) && <Button disabled={busy || reviews.length > 0} onClick={() => void perform('run')}>执行下一阶段</Button>}
      {status !== 'NOT_STARTED' && <Button disabled={busy} onClick={() => void perform('sync')}>刷新进度</Button>}
      <span>{status === 'AWAITING_REVIEW' ? '等待人工审核' : status === 'PAUSED' ? '已暂停，需核对任务与预算' : status}</span>
      {reviews.length > 0 && <Button onClick={() => dialog.current?.showModal()}>审核候选（{reviews.length}）</Button>}
    </div>
    {message && <p role="alert">{message}</p>}
    <dialog ref={dialog} style={{ background: '#17201f', color: '#ede8dc', padding: 24, border: '1px solid #8b7960', borderRadius: 12, maxWidth: 850, width: '90vw', maxHeight: '85vh', overflow: 'auto' }}>
      <h2>候选素材审核</h2><p>请打开输出中的素材地址检查画面、动作和一致性。元数据不代表画面通过；采纳后仍需手动执行下一阶段。</p>
      {message && <p role="alert">{message}</p>}
      {reviews.map(job => <article key={job.humanReview.digest} className="my-4 space-y-2">
        <h3>{job.type} ? {job.id}</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(job.output, null, 2)}</pre>
        <label>审核结论<textarea value={reasons[job.id] ?? ''} onChange={e => setReasons({ ...reasons, [job.id]: e.target.value })} placeholder="画面、动作、一致性及返工原因" /></label>
        <div className="flex gap-3"><Button disabled={busy || !reasons[job.id]?.trim()} onClick={() => void review(job, true)}>已看素材，采纳此版</Button><Button disabled={busy || !reasons[job.id]?.trim()} onClick={() => void review(job, false)}>拒收</Button></div>
      </article>)}
      {!reviews.length && <p>当前没有待审素材。</p>}
      <Button onClick={() => dialog.current?.close()}>稍后处理</Button>
    </dialog>
  </section>;
}
