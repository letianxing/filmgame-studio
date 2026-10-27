import {
  Activity,
  ChevronRight,
  CircleCheck,
  Clapperboard,
  Clock3,
  Film,
  GitBranch,
  LockKeyhole,
  Network,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { IdeaComposer } from '@/components/idea-composer';
import { listProjects } from '@/lib/database';

const navItems = [
  { label: '漫剧工作台', icon: Film, href: '/drama' },
  { label: '制作教程', icon: Play, href: '/learn' },
  { label: '创意', icon: Sparkles, href: '/', active: true },
  { label: '故事', icon: GitBranch, href: '/story' },
  { label: '制作', icon: Clapperboard, href: '/production' },
  { label: '试玩', icon: Play, href: '/playtest' },
  { label: '发布', icon: Film, href: '/publish' },
];

const roles = [
  ['记者', '追查酒店旧案', '掌握 2 条私密线索'],
  ['刑警', '找出真正凶手', '可执行搜查与盘问'],
  ['心理学家', '保护一名未知角色', '洞察情绪与谎言'],
  ['酒店老板', '保住酒店声誉', '控制部分区域权限'],
  ['演员', '隐瞒真实身份', '可伪造一次证词'],
  ['死者弟弟', '完成私人复仇', '持有未公开遗物'],
];

const pipeline: ReadonlyArray<readonly [string, string, boolean]> = [
  ['项目简报', '完成', true],
  ['世界观与角色', '已结构化', true],
  ['多人故事图', '生成中', false],
  ['剧本与分镜', '等待依赖', false],
  ['媒体资产', '等待锁定', false],
];

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  const projects = user ? await listProjects(user.userId) : [];
  const activeProject = projects[0];
  const projectQuery = activeProject ? `?projectId=${encodeURIComponent(activeProject.id)}` : '';
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center border-b border-border bg-[color:var(--chrome)] px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-8 place-items-center border border-[color:var(--signal)]/40 bg-[color:var(--signal)]/10 text-[color:var(--signal)]">
            <Clapperboard className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">FilmGame Studio</p>
            <p className="truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Multiplayer interactive film system
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="hidden border-emerald-400/25 bg-emerald-400/8 text-emerald-300 sm:flex">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {activeProject?.current_story_version ? `Story v${activeProject.current_story_version} 已同步` : '等待 Story Model'}
          </Badge>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            {activeProject?.title ?? '尚未选择项目'}
            <ChevronRight data-icon="inline-end" />
          </Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[196px_minmax(0,1fr)_310px]">
        <aside className="hidden border-r border-border bg-[color:var(--chrome)] p-3 lg:flex lg:flex-col">
          <nav aria-label="创作流程" className="space-y-1">
            {navItems.map(({ label, icon: Icon, href, active }) => (
              <Link
                key={label}
                href={href === '/' ? href : `${href}${projectQuery}`}
                className={`flex h-10 w-full items-center gap-3 border px-3 text-left text-sm transition-colors ${
                  active
                    ? 'border-[color:var(--signal)]/25 bg-[color:var(--signal)]/9 text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className={`size-4 ${active ? 'text-[color:var(--signal)]' : ''}`} />
                {label}
                {active ? <span className="ml-auto size-1.5 bg-[color:var(--signal)]" /> : null}
              </Link>
            ))}
          </nav>

          <div className="mt-7 border-t border-border pt-5">
            <p className="px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Project health
            </p>
            <dl className="mt-3 space-y-3 px-3 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">角色参与度</dt>
                <dd className="font-mono text-emerald-300">均衡</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">有效结局</dt>
                <dd className="font-mono">6</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">预计时长</dt>
                <dd className="font-mono">92 min</dd>
              </div>
            </dl>
          </div>

          <div className="mt-auto border border-border bg-card/40 p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ShieldCheck className="size-4 text-emerald-300" />
              权威状态受保护
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              AI 只能提出变更。Schema 与服务端规则引擎决定真正的状态变化。
            </p>
          </div>
        </aside>

        <section className="min-w-0 bg-[radial-gradient(circle_at_80%_0%,var(--signal-glow),transparent_28%)] p-4 sm:p-6 xl:p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--signal)]">
                  <Activity className="size-3.5" />
                  Idea → Structured Story
                </p>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  用一句话，启动整部多人影游
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  创意会先转成可验证、可版本化的故事模型，再进入制作、试玩和发布链路。
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="size-4" />
                {activeProject ? `最近保存 ${new Date(activeProject.updated_at).toLocaleString('zh-CN')} · Story v${activeProject.current_story_version}` : '创建第一个项目后自动保存'}
              </div>
            </div>

            <IdeaComposer signedIn={Boolean(user)} signInPath={chatGPTSignInPath('/')} />

            {projects.length ? (
              <section className="mt-5 border border-border bg-card/60">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h2 className="text-sm font-medium">最近项目</h2>
                  <span className="font-mono text-[10px] text-muted-foreground">{projects.length} PROJECTS</span>
                </div>
                <div className="divide-y divide-border">
                  {projects.slice(0, 5).map((project) => (
                    <Link key={project.id} href={`/story?projectId=${encodeURIComponent(project.id)}`} className="flex items-center gap-3 px-4 py-3 text-xs hover:bg-muted/35">
                      <span className="font-medium">{project.title}</span>
                      <span className="text-muted-foreground">{project.status}</span>
                      <span className="ml-auto font-mono text-[color:var(--signal)]">Story v{project.current_story_version}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
              <section className="border border-border bg-card/60">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="size-4 text-[color:var(--signal)]" />
                    角色与私人动机
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">6 / 6 ROLES</span>
                </div>
                <div className="grid sm:grid-cols-2">
                  {roles.map(([name, goal, ability], index) => (
                    <article
                      key={name}
                      className={`p-4 ${index % 2 === 0 ? 'sm:border-r' : ''} ${index < 4 ? 'border-b' : ''} border-border`}
                    >
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold">{name}</h2>
                        <LockKeyhole className="size-3.5 text-muted-foreground" />
                      </div>
                      <p className="mt-2 text-xs text-foreground/85">{goal}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{ability}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="border border-border bg-card/60">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Network className="size-4 text-[color:var(--signal)]" />
                    生成链路
                  </div>
                  <span className="font-mono text-[10px] text-[color:var(--signal)]">68%</span>
                </div>
                <div className="p-4">
                  <Progress value={68} className="[&_[data-slot=progress-indicator]]:bg-[color:var(--signal)]" />
                  <ol className="mt-5 space-y-1">
                    {pipeline.map(([name, status, complete], index) => (
                      <li key={name} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-0">
                        {complete ? (
                          <CircleCheck className="size-4 text-emerald-300" />
                        ) : (
                          <span className={`grid size-4 place-items-center border text-[9px] font-mono ${index === 2 ? 'border-[color:var(--signal)] text-[color:var(--signal)]' : 'border-border text-muted-foreground'}`}>
                            {index + 1}
                          </span>
                        )}
                        <span className="text-xs font-medium">{name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{status}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </section>
            </div>
          </div>
        </section>

        <aside className="hidden border-l border-border bg-[color:var(--chrome)] p-4 lg:block">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">结构化提案</h2>
            <Badge variant="outline" className="border-amber-300/25 bg-amber-300/8 text-amber-200">待确认</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            AI 已识别创作意图。应用前可比较依赖、验证结果和选择性重生成范围。
          </p>

          <div className="mt-5 space-y-3">
            <ProposalRow label="类型" value="悬疑 · 封闭空间" />
            <ProposalRow label="玩家" value="6 个非对称角色" />
            <ProposalRow label="结构" value="4 章 · 18 场景" />
            <ProposalRow label="动作" value="角色专属 + 组合裁决" />
            <ProposalRow label="结局" value="6 标准 · 2 隐藏" />
          </div>

          <div className="mt-5 border border-border bg-background/40 p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">Validation</p>
            <ul className="mt-3 space-y-2 text-xs">
              <li className="flex items-center gap-2"><CircleCheck className="size-3.5 text-emerald-300" />无不可达结局</li>
              <li className="flex items-center gap-2"><CircleCheck className="size-3.5 text-emerald-300" />无角色信息泄露</li>
              <li className="flex items-center gap-2"><CircleCheck className="size-3.5 text-emerald-300" />参与度差异低于 12%</li>
            </ul>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="outline">查看差异</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/85">应用提案</Button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ProposalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border pb-3">
      <p className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs font-medium">{value}</p>
    </div>
  );
}
