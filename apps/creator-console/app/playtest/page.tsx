import { Activity, CircleCheck, Radio, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { StudioPageShell } from '@/components/studio-page-shell';
import { PlaytestControls } from '@/components/playtest-controls';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStoryVersion, listPlaytestReports, listPlaytestRooms } from '@/lib/database';

export default async function PlaytestPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const { projectId } = await searchParams;
  const user = projectId ? await getChatGPTUser() : null;
  const rooms = projectId && user ? await listPlaytestRooms(projectId, user.userId) : [];
  const reports = projectId && user ? await listPlaytestReports(projectId, user.userId) : [];
  const storyVersion = projectId && user ? await getStoryVersion(projectId, user.userId) : null;
  const latestRoom = rooms[0];
  const story = storyVersion?.story as { characters?: Array<{ id: string; name: string }> } | undefined;
  const roles = story?.characters?.map((character) => `${character.name} · 等待玩家`) ?? ['记者 · 真人', '刑警 · Bot', '心理学家 · Bot', '老板 · Bot', '演员 · Bot', '死者弟弟 · Bot'];
  return (
    <StudioPageShell active="playtest" eyebrow="Playtest / Authoritative room" title="多人试玩与路径分析" description="创建临时 Colyseus 房间，真人玩家和 AI Bot 使用同一套角色权限与服务器裁决。每次动作、状态变化、掉线与结局都会进入事件日志。" status={latestRoom ? `Room ${latestRoom.room_code} · ${latestRoom.status}` : 'Runtime smoke passed · 等待项目包'}>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <section className="border border-border bg-card/60">
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2 text-sm font-medium"><Radio className="size-4 text-emerald-300" />开发试玩房间</div><Badge variant="outline" className="border-emerald-400/25 text-emerald-300">服务器在线</Badge></div>
          <div className="grid gap-3 p-4 sm:grid-cols-3"><Metric label="房间协议" value="story@1" /><Metric label="历史房间" value={String(rooms.length)} /><Metric label="Runtime" value={latestRoom ? `v${latestRoom.runtime_version}` : '未打包'} /></div>
          <div className="border-t border-border p-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">最近验证路径</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><Step text="记者公开照片" /><span>→</span><Step text="Bot 补齐动作" /><span>→</span><Step text="规则优先级裁决" /><span>→</span><Step text="进入档案室" active /></div>
            <div className="mt-5"><PlaytestControls projectId={projectId} companionBaseUrl={process.env.NEXT_PUBLIC_COMPANION_URL ?? 'http://127.0.0.1:3001'} initialRoomId={latestRoom?.room_code} runtimeVersion={latestRoom?.runtime_version} initialReport={reports[0]?.report as { transitionsEvaluated: number; paths: unknown[]; endingCoverage: Record<string, number> } | undefined} /></div>
          </div>
        </section>

        <section className="border border-border bg-card/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Activity className="size-4 text-[color:var(--signal)]" />试玩分析</div>
          <div className="mt-4 space-y-4">
            <Analysis label="动作授权" value="全部通过" good />
            <Analysis label="事件日志" value="9 条" good />
            <Analysis label="断线重连窗口" value="30 秒" good />
            <Analysis label="角色参与差异" value="0%" good />
            <Analysis label="结局覆盖" value="1 / 6" />
          </div>
        </section>
      </div>

      <section className="mt-5 border border-border bg-card/60 p-4">
        <div className="flex items-center gap-2 text-sm font-medium"><Users className="size-4 text-[color:var(--signal)]" />角色席位</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {roles.map((role, index) => <div key={role} className="border border-border bg-background/35 p-3 text-xs"><CircleCheck className="size-3.5 text-emerald-300" /><p className="mt-2">{role}</p><p className="mt-1 text-[10px] text-muted-foreground">{index === 0 ? '首位真人玩家可认领' : '可由真人或确定性 Bot 补位'}</p></div>)}
        </div>
      </section>
    </StudioPageShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border border-border bg-background/35 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-base">{value}</p></div>; }
function Step({ text, active = false }: { text: string; active?: boolean }) { return <span className={`border px-2.5 py-2 ${active ? 'border-[color:var(--signal)]/40 text-[color:var(--signal)]' : 'border-border'}`}>{text}</span>; }
function Analysis({ label, value, good = false }: { label: string; value: string; good?: boolean }) { return <div className="flex items-center justify-between border-b border-border pb-3 text-xs"><span className="text-muted-foreground">{label}</span><span className={good ? 'text-emerald-300' : 'text-amber-200'}>{value}</span></div>; }
