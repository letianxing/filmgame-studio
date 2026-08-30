import { AlertTriangle, CheckCircle2, CircleDashed, Clapperboard, Image, Mic2, ServerCog, Video } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { StudioPageShell } from '@/components/studio-page-shell';
import { ProductionControls } from '@/components/production-controls';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getLatestProductionRun, listProductionJobs } from '@/lib/database';

const shots = [
  ['SC001_SH01', '暴雪中的酒店远景', '已批准', '等待模型', '阻塞', '—'],
  ['SC001_SH02', '六人围在熄灭的吊灯下', '已批准', '等待模型', '阻塞', '等待声音'],
  ['SC001_SH03', '记者推开雪夜照片', '草稿', '阻塞', '阻塞', '等待声音'],
  ['SC014_SH04', '第七号档案柜打开', '计划中', '阻塞', '阻塞', '等待声音'],
];

export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const user = projectId ? await getChatGPTUser() : null;
  const run = projectId && user ? await getLatestProductionRun(projectId, user.userId) : null;
  const jobs = run && projectId && user ? await listProductionJobs(run.id, projectId, user.userId) : [];
  const readyJobs = jobs.filter((job) => job.status === 'READY').length;
  const completedJobs = jobs.filter((job) => job.status === 'SUCCEEDED').length;
  const estimatedCost = jobs.reduce(
    (total, job) => total + estimatedCostFromJson(job.output_json),
    0,
  );
  return (
    <StudioPageShell
      active="production"
      eyebrow="Generate / Production orchestrator"
      title="镜头与媒体生产"
      description="导演分解、分镜、角色/场景一致性、图片、视频、配音、字幕、音效和最终合成由作业图统一调度。失败、成本和 Provider 元数据会保留在每个镜头上。"
      status={run ? `Production v${run.production_version} · ${run.status}` : '生产链路已验证 · 等待项目'}
      aside={<ProviderStatus />}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Stage icon={Clapperboard} label="镜头" value="4" note="2 个场景已分解" />
        <Stage icon={Image} label="分镜 / 图片" value="1 verified" note="FLUX FP8 · SHA 已登记" />
        <Stage icon={Video} label="视频" value="Provider blocked" note="Wan 已安装；本机容量未获准" warning />
        <Stage icon={Mic2} label="角色语音" value="Adapter ready" note="CosyVoice2 已实测；角色声音待锁定" warning />
      </div>

      <section className="mt-5 border border-border bg-card/60">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium"><ServerCog className="size-4 text-[color:var(--signal)]" />Production DAG</div>
          <span className="font-mono text-xs text-muted-foreground">{readyJobs} ready · {completedJobs} / {jobs.length || 104} completed · ${estimatedCost.toFixed(2)}</span>
        </div>
        <div className="p-4">
          <Progress value={jobs.length ? (completedJobs / jobs.length) * 100 : 0} className="[&_[data-slot=progress-indicator]]:bg-[color:var(--signal)]" />
          <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
            {['Director', 'Character Ref', 'Location Ref', 'Storyboard', 'Image', 'Video', 'TTS', 'Subtitle', 'Render', 'QA', 'Package'].map((stage, index) => (
              <span key={stage} className={`border px-2.5 py-1.5 ${index < 2 ? 'border-emerald-400/25 bg-emerald-400/8 text-emerald-200' : index === 2 ? 'border-[color:var(--signal)]/35 text-[color:var(--signal)]' : 'border-border text-muted-foreground'}`}>{stage}</span>
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <ProductionControls projectId={projectId} initialStatus={run?.status} />
          </div>
        </div>
      </section>

      <section className="mt-5 overflow-x-auto border border-border bg-card/60">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="border-b border-border bg-background/35 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr><th className="px-4 py-3">Shot</th><th className="px-4 py-3">描述</th><th className="px-4 py-3">Storyboard</th><th className="px-4 py-3">Image</th><th className="px-4 py-3">Video</th><th className="px-4 py-3">Voice</th></tr>
          </thead>
          <tbody>
            {shots.map((shot) => (
              <tr key={shot[0]} className="border-b border-border/70 last:border-0">
                <td className="px-4 py-3 font-mono text-[color:var(--signal)]">{shot[0]}</td>
                <td className="px-4 py-3">{shot[1]}</td>
                {shot.slice(2).map((status, index) => <td key={`${shot[0]}-${index}`} className="px-4 py-3 text-muted-foreground">{status}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </StudioPageShell>
  );
}

function Stage({ icon: Icon, label, value, note, warning = false }: { icon: typeof Clapperboard; label: string; value: string; note: string; warning?: boolean }) {
  return <div className="border border-border bg-card/60 p-4"><div className="flex items-center justify-between"><Icon className="size-4 text-[color:var(--signal)]" />{warning ? <CircleDashed className="size-3.5 text-amber-200" /> : <CheckCircle2 className="size-3.5 text-emerald-300" />}</div><p className="mt-4 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{note}</p></div>;
}

function ProviderStatus() {
  return <div><h2 className="text-sm font-semibold">Provider readiness</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">图片、语音和媒体处理已经真实冒烟验证；视频、音乐和音效可通过稳定远程 Contract 接入。</p><div className="mt-4 space-y-3"><Provider name="ComfyUI / FLUX" state="已验证" ready /><Provider name="VideoProvider" state="待远程配置" /><Provider name="CosyVoice2" state="已验证" ready /><Provider name="Music / SFX" state="待远程配置" /><Provider name="FFmpeg" state="已验证" ready /></div><div className="mt-5 flex gap-2 border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-5 text-amber-100/80"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />不会降低内存安全线或用占位媒体冒充生成资产。未合格的 Provider 会保持 BLOCKED。</div></div>;
}

function Provider({ name, state, ready = false }: { name: string; state: string; ready?: boolean }) {
  return <div className="flex items-center justify-between border-b border-border pb-3 text-xs"><span>{name}</span><Badge variant="outline" className={ready ? 'border-emerald-300/25 text-emerald-200' : 'border-amber-300/25 text-amber-200'}>{state}</Badge></div>;
}

function estimatedCostFromJson(value: unknown): number {
  if (typeof value !== 'string') return 0;
  try {
    const parsed = JSON.parse(value) as unknown;
    return collectEstimatedCost(parsed, 0);
  } catch {
    return 0;
  }
}

function collectEstimatedCost(value: unknown, depth: number): number {
  if (depth > 8 || value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.reduce((total, entry) => total + collectEstimatedCost(entry, depth + 1), 0);
  if (typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const own = typeof record.estimatedCost === 'number' ? record.estimatedCost : 0;
  return own + Object.entries(record)
    .filter(([key]) => key !== 'estimatedCost')
    .reduce((total, [, entry]) => total + collectEstimatedCost(entry, depth + 1), 0);
}
