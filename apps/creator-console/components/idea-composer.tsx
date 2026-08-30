'use client';

import { CheckCircle2, LoaderCircle, LogIn, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const initialIdea =
  '创建一款 6 人、90 分钟的悬疑互动影游。故事发生在一座暴风雪封锁的山顶酒店。玩家分别扮演记者、刑警、心理学家、酒店老板、演员和死者弟弟。每个人都有秘密、私人目标和独立胜利条件；需要讨论、欺骗、合作和背叛。不同角色看到不同信息并拥有不同动作，不要简单多数投票。整体写实、电影感、冷峻、压抑，至少 6 个有效结局。';

type Submission = {
  project: { id: string; status: string };
  command: { id: string; status: string };
  orchestration?: { status: 'NOT_CONFIGURED' | 'DISPATCHED' | 'UNAVAILABLE'; jobId?: string };
  sync?: { status: string; version?: number };
  production?: { status: string; detail?: string };
};

export function IdeaComposer({
  signedIn,
  signInPath,
}: {
  signedIn: boolean;
  signInPath: string;
}) {
  const [idea, setIdea] = useState(initialIdea);
  const [status, setStatus] = useState<'IDLE' | 'SUBMITTING' | 'QUEUED' | 'SYNCING' | 'READY' | 'ERROR'>('IDLE');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState('');

  async function submit(): Promise<void> {
    setStatus('SUBMITTING');
    setError('');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: inferTitle(idea), idea }),
      });
      const payload = (await response.json()) as Submission & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setSubmission(payload);
      if (payload.orchestration?.status === 'DISPATCHED') {
        setStatus('SYNCING');
        void syncStory(payload.project.id);
      } else {
        setStatus('QUEUED');
      }
    } catch (cause) {
      setStatus('ERROR');
      setError(cause instanceof Error ? cause.message : '无法创建项目');
    }
  }

  async function syncStory(projectId: string): Promise<void> {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/sync`, {
          method: 'POST',
        });
        const payload = (await response.json()) as { status?: string; version?: number; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setSubmission((current) =>
          current ? { ...current, sync: { status: payload.status ?? 'UNKNOWN', ...(payload.version ? { version: payload.version } : {}) } } : current,
        );
        if (payload.status === 'STORY_READY') {
          const production = await startProduction(projectId);
          setSubmission((current) => (current ? { ...current, production } : current));
          setStatus('READY');
          return;
        }
        if (payload.status === 'FAILED') throw new Error(payload.error ?? 'Story Workflow 失败');
      } catch (cause) {
        setStatus('ERROR');
        setError(cause instanceof Error ? cause.message : '无法同步 Story Workflow');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    setStatus('ERROR');
    setError('Story Workflow 同步超时，可稍后从项目页继续同步。');
  }

  async function startProduction(projectId: string): Promise<{ status: string; detail?: string }> {
    const create = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
      method: 'POST',
    });
    const created = (await create.json()) as { error?: string };
    if (!create.ok) return { status: 'BLOCKED', detail: created.error ?? `HTTP ${create.status}` };
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const sync = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
        method: 'PUT',
      });
      const synced = (await sync.json()) as { status?: string; run?: { status?: string }; error?: string };
      if (!sync.ok) return { status: 'BLOCKED', detail: synced.error ?? `HTTP ${sync.status}` };
      const productionStatus = synced.run?.status ?? synced.status;
      if (productionStatus === 'PLANNED') {
        const execute = await fetch(`/api/projects/${encodeURIComponent(projectId)}/production`, {
          method: 'PATCH',
        });
        const execution = (await execute.json()) as { status?: string; error?: string; detail?: unknown };
        if (!execute.ok) {
          return {
            status: 'BLOCKED',
            detail: execution.detail
              ? `${execution.error}: ${JSON.stringify(execution.detail)}`
              : execution.error,
          };
        }
        return { status: execution.status ?? 'RUNNING' };
      }
      if (productionStatus === 'FAILED') {
        return { status: 'FAILED', detail: synced.error ?? 'Production planning failed' };
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return { status: 'BLOCKED', detail: 'Production planning sync timed out' };
  }

  return (
    <div className="border border-border bg-card/80 shadow-[0_24px_80px_rgb(0_0_0/28%)] backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-[color:var(--signal)]" />
          创作指令
        </div>
        <Badge variant="secondary" className="font-mono text-[10px]">自然语言主入口</Badge>
      </div>
      <div className="p-4 sm:p-5">
        <Textarea
          aria-label="影游创意"
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          className="min-h-32 resize-none border-0 bg-transparent p-0 text-[15px] leading-7 shadow-none focus-visible:ring-0"
        />
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">6 位玩家</Badge>
            <Badge variant="outline">悬疑</Badge>
            <Badge variant="outline">90 分钟</Badge>
            <Badge variant="outline">6+ 结局</Badge>
          </div>
          {signedIn ? (
            <Button
              size="lg"
              className="bg-[color:var(--signal)] px-4 text-slate-950 hover:bg-[color:var(--signal)]/85"
              disabled={['SUBMITTING', 'SYNCING', 'READY'].includes(status) || idea.trim().length < 40}
              onClick={() => void submit()}
            >
              {status === 'SUBMITTING' ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : status === 'QUEUED' || status === 'SYNCING' || status === 'READY' ? (
                <CheckCircle2 data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              {status === 'SUBMITTING'
                ? '正在创建…'
                : status === 'SYNCING'
                  ? '正在生成 Story Model…'
                  : status === 'READY'
                    ? 'Story Model 已就绪'
                    : status === 'QUEUED'
                      ? '已进入生成队列'
                      : '生成完整影游'}
            </Button>
          ) : (
            <Button
              render={<a href={signInPath} target="_top" aria-label="登录后开始生成" />}
              size="lg"
              className="bg-[color:var(--signal)] px-4 text-slate-950 hover:bg-[color:var(--signal)]/85"
            >
              <LogIn data-icon="inline-start" />
              登录后开始生成
            </Button>
          )}
        </div>
        {['QUEUED', 'SYNCING', 'READY'].includes(status) && submission ? (
          <div className={`mt-4 border px-3 py-2 text-xs ${submission.orchestration?.status === 'DISPATCHED' ? 'border-emerald-400/20 bg-emerald-400/6 text-emerald-200' : 'border-amber-300/20 bg-amber-300/5 text-amber-100/80'}`}>
            项目 {submission.project.id} 已创建；
            {submission.orchestration?.status === 'DISPATCHED'
              ? status === 'READY'
                ? ` Story v${submission.sync?.version ?? 1} 已写入版本库；Production ${submission.production?.status ?? 'PLANNING'}。`
                : ` Story Workflow 作业 ${submission.orchestration.jobId} 已启动并自动同步。`
              : ' 命令已安全排队，但 Orchestrator / LLM Provider 当前未配置。'}
            {status === 'READY' ? (
              <a className="ml-2 underline underline-offset-4" href={`/story?projectId=${encodeURIComponent(submission.project.id)}`}>
                打开 Story Studio
              </a>
            ) : null}
            {status === 'READY' ? (
              <a className="ml-2 underline underline-offset-4" href={`/production?projectId=${encodeURIComponent(submission.project.id)}`}>
                查看 Production DAG
              </a>
            ) : null}
            {submission.production?.detail ? (
              <p className="mt-2 text-amber-100/80">{submission.production.detail}</p>
            ) : null}
          </div>
        ) : null}
        {status === 'ERROR' ? (
          <div className="mt-4 border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            创建失败：{error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function inferTitle(idea: string): string {
  if (idea.includes('山顶酒店') || idea.includes('暴风雪')) return '雪封山庄';
  return idea.trim().slice(0, 24).replace(/[。！？,.!?]+$/u, '') || '未命名影游';
}
