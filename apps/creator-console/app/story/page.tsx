import { AlertTriangle, ArrowRight, CircleCheck, GitBranch, LockKeyhole, Sparkles, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { StudioPageShell } from '@/components/studio-page-shell';
import { StoryChangeComposer } from '@/components/story-change-composer';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getStoryVersion } from '@/lib/database';

const scenes = [
  { id: 'SC001', title: '停电后的第一轮指控', kind: '公共场景', active: true },
  { id: 'SC008', title: '记者的秘密通话', kind: '角色私密', active: false },
  { id: 'SC014', title: '第七号档案柜', kind: '多人裁决', active: false },
  { id: 'ED006', title: '第二具尸体', kind: '隐藏结局', active: false },
];

export default async function StoryPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  const user = projectId ? await getChatGPTUser() : null;
  const saved = projectId && user ? await getStoryVersion(projectId, user.userId) : null;
  const story = saved?.story as StudioStory | undefined;
  const storyScenes: StudioSceneView[] = story?.scenes?.length
    ? story.scenes.map((scene, index) => ({
        ...scene,
        kind: Object.keys(scene.privateInformationByRole ?? {}).length ? '多人私密场景' : '公共场景',
        active: index === 0,
      }))
    : scenes;
  const activeScene = storyScenes[0]!;
  const actionCount = Object.values(activeScene.availableActionsByRole ?? {}).reduce(
    (total, actions) => total + actions.length,
    0,
  );
  return (
    <StudioPageShell
      active="story"
      eyebrow="Design / Story graph"
      title="多人故事模型"
      description="每个场景同时描述公共信息、角色私密信息、可执行动作、裁决规则与状态变化。这里编辑的是正式 Story Model，不是聊天记录。"
      status={saved ? `Story v${saved.version} · 已验证` : '示例 Story · 等待选择项目'}
      aside={<StoryInspector characters={story?.characters} endingCount={story?.endings?.length} valid={story ? true : undefined} />}
    >
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="border border-border bg-card/60">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium"><GitBranch className="size-4 text-[color:var(--signal)]" />故事结构</div>
            <Badge variant="secondary">{story?.chapters?.length ?? 2} 章 · {storyScenes.length} 场景</Badge>
          </div>
          <div className="p-2">
            {storyScenes.map((scene) => (
              <button key={scene.id} type="button" className={`mb-1 w-full border p-3 text-left ${scene.active ? 'border-[color:var(--signal)]/35 bg-[color:var(--signal)]/8' : 'border-transparent hover:border-border hover:bg-muted/40'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground">{scene.id}</span>
                  {scene.active ? <span className="size-1.5 bg-[color:var(--signal)]" /> : null}
                </div>
                <p className="mt-1 text-xs font-medium">{scene.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{scene.kind}</p>
              </button>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <section className="border border-border bg-card/60 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">{activeScene.id}</Badge>
              <h2 className="text-base font-semibold">{activeScene.title}</h2>
              <Badge variant="outline" className="ml-auto border-emerald-400/25 text-emerald-300">可达</Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{activeScene.summary ?? '当前场景包含角色差异化信息、动作与服务器裁决。'}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label="在场角色" value={`${activeScene.rolesPresent?.length ?? 6} / ${story?.characters?.length ?? 6}`} />
              <Metric label="角色动作" value={String(actionCount || 6)} />
              <Metric label="裁决规则" value={String(activeScene.resolutionRules?.length ?? 2)} />
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">Story flow</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Node label="公开信息" />
                <ArrowRight className="size-3 text-muted-foreground" />
                <Node label="角色私密信息" />
                <ArrowRight className="size-3 text-muted-foreground" />
                <Node label="玩家动作" active />
                <ArrowRight className="size-3 text-muted-foreground" />
                <Node label="服务器裁决" />
                <ArrowRight className="size-3 text-muted-foreground" />
                <Node label={activeScene.nextSceneCandidates?.[0] ?? 'Ending'} />
              </div>
            </div>
          </section>

          <section className="border border-border bg-card/60">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
              <Sparkles className="size-4 text-[color:var(--signal)]" />
              继续用自然语言修改
            </div>
            <div className="p-4">
              <StoryChangeComposer projectId={projectId} currentVersion={saved?.version} />
            </div>
          </section>
        </div>
      </div>
    </StudioPageShell>
  );
}

function StoryInspector({ characters, endingCount, valid }: { characters?: StudioStory['characters']; endingCount?: number; valid?: boolean }) {
  const roleItems = characters?.slice(0, 6).map((character) => `${character.name} · ${character.publicProfile.role}`) ?? ['记者 · 公开照片', '刑警 · 组织搜查', '心理学家 · 观察反应', '老板 · 封锁档案室'];
  return (
    <div>
      <div className="flex items-center gap-2"><Users className="size-4 text-[color:var(--signal)]" /><h2 className="text-sm font-semibold">角色视角</h2></div>
      <div className="mt-4 space-y-3">
        {roleItems.map((item, index) => (
          <div key={item} className="border-b border-border pb-3 text-xs">
            <div className="flex items-center gap-2"><LockKeyhole className="size-3.5 text-muted-foreground" />{item}</div>
            <p className="mt-1 pl-5 text-[10px] text-muted-foreground">{index === 0 ? '含 1 条私密前置条件' : '仅对应角色可见'}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 border border-border bg-background/35 p-3">
        <p className="flex items-center gap-2 text-xs font-medium"><CircleCheck className="size-3.5 text-emerald-300" />验证通过</p>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{valid ? `结构化 Story 已写入版本库；共 ${endingCount ?? 0} 个结局。` : '无死路、无私密信息泄露，示例中的 6 个结局均有触发规则。'}</p>
      </div>
      <div className="mt-3 flex gap-2 border border-amber-300/20 bg-amber-300/5 p-3 text-[11px] leading-5 text-amber-100/80">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        第三章尚未生成；此处展示当前已验证的结构片段。
      </div>
    </div>
  );
}

interface StudioStory {
  chapters?: Array<{ id: string }>;
  characters?: Array<{ id: string; name: string; publicProfile: { role: string } }>;
  endings?: Array<{ id: string }>;
  scenes?: Array<{
    id: string;
    title: string;
    summary?: string;
    rolesPresent?: string[];
    privateInformationByRole?: Record<string, string[]>;
    availableActionsByRole?: Record<string, unknown[]>;
    resolutionRules?: unknown[];
    nextSceneCandidates?: string[];
  }>;
}

interface StudioSceneView {
  id: string;
  title: string;
  kind: string;
  active: boolean;
  summary?: string;
  rolesPresent?: string[];
  privateInformationByRole?: Record<string, string[]>;
  availableActionsByRole?: Record<string, unknown[]>;
  resolutionRules?: unknown[];
  nextSceneCandidates?: string[];
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-border bg-background/35 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg">{value}</p></div>;
}

function Node({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={`border px-3 py-2 ${active ? 'border-[color:var(--signal)]/45 bg-[color:var(--signal)]/10 text-[color:var(--signal)]' : 'border-border bg-background/40'}`}>{label}</span>;
}
