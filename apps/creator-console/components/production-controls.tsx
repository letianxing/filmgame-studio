'use client';

import { LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

export function ProductionControls({
  projectId,
  initialStatus,
}: {
  projectId?: string;
  initialStatus?: string;
}) {
  const [status, setStatus] = useState(initialStatus ?? 'NOT_STARTED');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function startPlan(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
        method: 'POST',
      });
      const payload = (await response.json()) as { run?: { status?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setStatus(payload.run?.status ?? 'PLANNING');
      await poll('PLANNED');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '无法创建 Production Plan');
    } finally {
      setBusy(false);
    }
  }

  async function execute(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
        method: 'PATCH',
      });
      const payload = (await response.json()) as { error?: string; detail?: unknown };
      if (!response.ok) {
        throw new Error(
          payload.detail ? `${payload.error}: ${JSON.stringify(payload.detail)}` : payload.error ?? `HTTP ${response.status}`,
        );
      }
      setStatus('RUNNING');
      await poll('COMPLETED');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '生产执行未获准');
    } finally {
      setBusy(false);
    }
  }

  async function poll(target: 'PLANNED' | 'COMPLETED'): Promise<void> {
    if (!projectId) return;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
        method: 'PUT',
      });
      const payload = (await response.json()) as {
        status?: string;
        run?: { status?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      const next = payload.run?.status ?? payload.status ?? 'UNKNOWN';
      setStatus(next);
      if (next === target) {
        window.location.reload();
        return;
      }
      if (next === 'FAILED') throw new Error(payload.error ?? 'Production Workflow 失败');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error('Production Workflow 同步超时');
  }

  if (!projectId) {
    return <p className="text-xs text-muted-foreground">从项目列表或 Story Studio 进入后可创建生产计划。</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === 'NOT_STARTED' ? (
        <Button onClick={() => void startPlan()} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          创建 Production Plan
        </Button>
      ) : null}
      {status === 'PLANNED' || status === 'FAILED' ? (
        <Button onClick={() => void execute()} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Play data-icon="inline-start" />}
          启动生产 DAG
        </Button>
      ) : null}
      <span className="font-mono text-xs text-muted-foreground">{status}</span>
      {message ? <p className="w-full text-xs text-amber-200">{message}</p> : null}
    </div>
  );
}
