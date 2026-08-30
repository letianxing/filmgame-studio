'use client';

import { Check, LoaderCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Proposal {
  status: 'READY' | 'NEEDS_INPUT' | 'INVALID' | 'LOCK_CONFLICT';
  intent: { type: string; targetEntityIds: string[]; unresolvedQuestions: string[] };
  patch: Array<{ op: string; path: string; value?: unknown }>;
  dependencyImpact: { stages: string[]; lockedAssetConflicts: unknown[] };
  validation: { valid: boolean; issues: Array<{ severity: string; message: string }> };
}

export function StoryChangeComposer({ projectId, currentVersion = 0 }: { projectId?: string; currentVersion?: number }) {
  const [text, setText] = useState('');
  const [commandId, setCommandId] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function propose(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/changes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const payload = (await response.json()) as { commandId?: string; proposal?: Proposal; error?: string };
      if (!response.ok || !payload.commandId || !payload.proposal) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
      setCommandId(payload.commandId);
      setProposal(payload.proposal);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '无法生成变更预览');
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<void> {
    if (!projectId || !commandId || proposal?.status !== 'READY') return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/changes`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commandId }),
      });
      const payload = (await response.json()) as { status?: string; version?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setMessage(`Story v${payload.version} 已创建；受影响的下游 Job 将选择性再生成。`);
      window.location.reload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '无法应用变更');
    } finally {
      setBusy(false);
    }
  }

  async function rollback(): Promise<void> {
    if (!projectId || currentVersion <= 1) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/changes`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetVersion: currentVersion - 1 }),
      });
      const payload = (await response.json()) as { version?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setMessage(`已回滚并创建 Story v${payload.version}。`);
      window.location.reload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '无法回滚 Story Version');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Textarea
        aria-label="故事修改指令"
        placeholder="例如：把心理学家改成医生，保留现有秘密和胜利条件。"
        className="min-h-24 bg-background/35"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">结构化 Patch 会先展示版本差异、验证与依赖影响。</p>
        <Button disabled={!projectId || text.trim().length < 2 || busy} onClick={() => void propose()}>
          {busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
          预览变更
        </Button>
      </div>
      {currentVersion > 1 ? (
        <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void rollback()}>
          回滚到 Story v{currentVersion - 1}
        </Button>
      ) : null}
      {proposal ? (
        <div className="mt-4 space-y-3 border border-border bg-background/35 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span>Intent: {proposal.intent.type}</span>
            <span className="font-mono text-[color:var(--signal)]">{proposal.status}</span>
          </div>
          <p className="text-muted-foreground">Patch：{proposal.patch.map((patch) => `${patch.op} ${patch.path}`).join('；') || '等待补充信息'}</p>
          <p className="text-muted-foreground">选择性再生成：{proposal.dependencyImpact.stages.join(' → ') || '无'}</p>
          {proposal.intent.unresolvedQuestions.map((question) => <p key={question} className="text-amber-200">需要确认：{question}</p>)}
          {proposal.validation.issues.map((issue) => <p key={`${issue.severity}-${issue.message}`} className={issue.severity === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'}>{issue.severity}: {issue.message}</p>)}
          <Button disabled={proposal.status !== 'READY' || busy} onClick={() => void apply()}>
            <Check data-icon="inline-start" />应用为新版本
          </Button>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs text-amber-100">{message}</p> : null}
    </>
  );
}
