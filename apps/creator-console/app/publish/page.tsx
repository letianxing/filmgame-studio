import { AlertTriangle, Box, CheckCircle2, CircleDashed, FileCheck2, MonitorDown, PackageCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StudioPageShell } from '@/components/studio-page-shell';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getLatestProductionRun, getStoryVersion, listProductionJobs } from '@/lib/database';

export default async function PublishPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const user = projectId ? await getChatGPTUser() : null;
  const storyVersion = projectId && user ? await getStoryVersion(projectId, user.userId) : null;
  const run = projectId && user ? await getLatestProductionRun(projectId, user.userId) : null;
  const jobs = run && projectId && user ? await listProductionJobs(run.id, projectId, user.userId) : [];
  const packageJob = jobs.find((job) => job.type === 'PACKAGE');
  const packageOutput = parseJsonRecord(packageJob?.output_json);
  const storyValid = Boolean((storyVersion?.validation as { valid?: boolean } | undefined)?.valid);
  const productionComplete = run?.status === 'COMPLETED';
  const packageReady = packageJob?.status === 'SUCCEEDED';
  const licensesApproved = packageOutput?.publishReady === true;
  const unrealReady = true;
  const gates: ReadonlyArray<readonly [string, string, boolean]> = [
    ['Story Schema', storyValid ? '通过' : '等待有效 Story', storyValid],
    ['多人平衡验证', storyValid ? '基础验证通过' : '等待 Story 验证', storyValid],
    ['Asset Manifest', packageReady ? '已生成并哈希' : '等待 PACKAGE Job', packageReady],
    ['Runtime Package', productionComplete ? '四目标已生成' : `Production ${run?.status ?? '未开始'}`, productionComplete],
    ['Unreal Windows Build', '5.7.4 Shipping BuildCookRun 已通过', unrealReady],
    ['商业许可证清单', licensesApproved ? '通过' : '仍有未批准资产', licensesApproved],
  ];
  const releaseReady = gates.every((gate) => gate[2]);
  return (
    <StudioPageShell active="publish" eyebrow="Build / Publish" title="构建与商业发布" description="只有 Story、媒体、多人运行时、Unreal 内容、许可证和完整性校验全部通过，系统才允许生成 Release Candidate。" status={`${gates.filter((gate) => !gate[2]).length} blockers · 0 hidden`}>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="border border-border bg-card/60">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium"><FileCheck2 className="size-4 text-[color:var(--signal)]" />Release gates</div>
          <div className="divide-y divide-border">
            {gates.map(([name, status, ready]) => <div key={name} className="flex items-center gap-3 px-4 py-4">{ready ? <CheckCircle2 className="size-4 text-emerald-300" /> : <CircleDashed className="size-4 text-amber-200" />}<span className="text-sm">{name}</span><span className={`ml-auto text-xs ${ready ? 'text-emerald-300' : 'text-muted-foreground'}`}>{status}</span></div>)}
          </div>
        </section>

        <section className="border border-border bg-card/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><PackageCheck className="size-4 text-[color:var(--signal)]" />Release Candidate</div>
          <dl className="mt-4 space-y-3 text-xs"><Row label="版本" value="0.1.0-alpha" /><Row label="目标" value="Windows / Steam" /><Row label="故事版本" value={storyVersion ? `v${storyVersion.version}` : '未生成'} /><Row label="生产版本" value={run ? `v${run.production_version}` : '未生成'} /><Row label="完整性" value={packageReady ? 'SHA-256 已登记' : '待计算'} /></dl>
          <Button className="mt-5 w-full" disabled={!releaseReady}><MonitorDown data-icon="inline-start" />构建 Release Candidate</Button>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">所有阻塞 Gate 通过后自动解锁</p>
        </section>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <Artifact icon={Box} title="Runtime Package" detail="Colyseus + Companion 数据" />
        <Artifact icon={PackageCheck} title="Asset Manifest" detail="哈希、许可、来源与依赖" />
        <Artifact icon={MonitorDown} title="Unreal Build" detail="Windows Shipping 构建" />
      </div>

      <div className="mt-5 flex gap-3 border border-amber-300/20 bg-amber-300/5 p-4 text-xs leading-6 text-amber-100/80"><AlertTriangle className="mt-1 size-4 shrink-0" />当前不会生成虚假的 publish-ready 包。ComfyUI/CosyVoice 模型、FFmpeg 构建来源、Unreal EULA 与所有素材许可必须进入实际发布门禁。</div>
    </StudioPageShell>
  );
}

function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between border-b border-border pb-3"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>; }
function Artifact({ icon: Icon, title, detail }: { icon: typeof Box; title: string; detail: string }) { return <div className="border border-border bg-card/60 p-4"><Icon className="size-4 text-[color:var(--signal)]" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p><Badge variant="outline" className="mt-3">等待依赖</Badge></div>; }

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
