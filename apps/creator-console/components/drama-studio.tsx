'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Film, Sparkles, Download, LoaderCircle, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { DramaTutorials } from '@/components/drama-tutorials';
import type { DramaContent, DramaCharacter } from '../../../packages/shared-types/src/drama';
import type { DramaRecord } from '../../../packages/shared-types/src/drama';

type Project = { id: string; title: string; status: string };
type RecordView = Omit<DramaRecord, 'ownerId' | 'history'> & { versions: Array<{ version: number; title: string }> };
const defaultIdea = '做一集 30 秒的水彩风格悬疑漫剧，4 个镜头。雨夜，一个穿蓝色外套的女孩在旧书店收到一封来自明天的信。只有她一个主角，少量对白，镜头从街景推进到信封特写，结尾发现信上的字正在消失。横屏 16:9。';
const field = 'w-full rounded-md border border-border bg-background p-2 text-sm';
function toContent(record: RecordView): DramaContent | null {
  if (!record.document) return null;
  const { title, visualStyle, aspectRatio, characters, episodes } = record.document;
  return { title, visualStyle, aspectRatio, characters, episodes };
}

export function DramaStudio({ signedIn, signInPath, initialId, initialPrompt }: {
  signedIn: boolean; signInPath: string; initialId?: string; initialPrompt?: string;
}) {
  const [idea, setIdea] = useState(initialPrompt ?? defaultIdea);
  const [id, setId] = useState(initialId ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const receivedVersion = useRef('');
  const [record, setRecord] = useState<RecordView | null>(null);
  const [draft, setDraft] = useState<DramaContent | null>(null);
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'script' | 'characters' | 'output' | 'learn'>('script');
  const [mode, setMode] = useState<'VIDEO' | 'STORYBOARD'>('VIDEO');
  const [videoBackend, setVideoBackend] = useState<'WAN' | 'SEEDANCE'>('WAN');
  const [musicPrompt, setMusicPrompt] = useState('');
  const active = record?.status === 'GENERATING' || record?.status === 'REVISING' || record?.renders.some((r) => r.status === 'RUNNING');
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(record ? toContent(record) : null);
  const latestRun = record?.renders.at(-1);
  const shotCount = draft?.episodes.reduce((sum, episode) => sum + episode.shots.length, 0) ?? 0;
  const seconds = draft?.episodes.flatMap((e) => e.shots).reduce((n, s) => n + s.durationSeconds, 0) ?? 0;

  const accept = useCallback((value: RecordView) => {
    const versionKey = `${value.id}:${value.document?.version ?? 0}`;
    if (receivedVersion.current !== versionKey) { setDraft(toContent(value)); receivedVersion.current = versionKey; }
    setRecord(value);
  }, []);
  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const list = await fetch('/api/dramas'); const payload = await list.json() as { error?: string; projects: Project[] };
    if (!list.ok) throw new Error(payload.error ?? '无法读取项目'); setProjects(payload.projects);
    if (id) {
      const response = await fetch(`/api/dramas/${id}`); const value = await response.json() as RecordView & { error?: string; asset: { id: string } };
      if (!response.ok) throw new Error(value.error ?? '无法读取项目'); accept(value);
    }
  }, [signedIn, id, accept]);
  useEffect(() => { const timer = setTimeout(() => { void refresh().catch((e) => setError(e.message)); }, 0); return () => clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void refresh().catch((e) => setError(e.message)); }, 3000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  async function action(body: object, create = false) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/dramas${create ? '' : `/${id}`}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const value = await response.json() as RecordView & { error?: string; asset: { id: string } }; if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
      if (value.id) {
        accept(value); if (create) { setId(value.id); window.history.replaceState(null, '', `/drama?projectId=${value.id}`); }
        if (body && 'action' in body && body.action === 'save') setDraft(toContent(value));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  }
  function updateCharacter(index: number, patch: Partial<DramaCharacter>) {
    setDraft((current) => current ? { ...current, characters: current.characters.map((c, i) => i === index ? { ...c, ...patch } : c) } : current);
  }
  async function upload(index: number, file: File | undefined, kind: 'image' | 'voice') {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError('参考素材不能超过 20 MB'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/dramas/${id}/assets`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
      const value = await response.json() as RecordView & { error?: string; asset: { id: string } }; if (!response.ok) throw new Error(value.error);
      updateCharacter(index, kind === 'image' ? { referenceImageAssetId: value.asset.id } : { voiceReferenceAssetId: value.asset.id, rightsConfirmed: false });
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败'); }
    finally { setBusy(false); }
  }
  function assetUrl(asset: string, download = false) { return `/api/dramas/${id}/assets/${asset}${download ? '?download=1' : ''}`; }
  function updateShot(episodeIndex: number, shotIndex: number, patch: object) {
    setDraft((current) => current ? { ...current, episodes: current.episodes.map((episode, e) => e === episodeIndex
      ? { ...episode, shots: episode.shots.map((shot, s) => s === shotIndex ? { ...shot, ...patch } : shot) } : episode) } : current);
  }
  async function uploadFirstFrame(e: number, s: number, file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 20 * 1024 * 1024) { setError('首帧须为20MB内PNG/JPEG'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/dramas/${id}/assets`, { method: 'POST', headers: { 'content-type': file.type }, body: file });
      const value = await response.json() as { error?: string; asset: { id: string } };
      if (!response.ok) throw new Error(value.error ?? '上传失败');
      updateShot(e, s, { firstFrameAssetId: value.asset.id });
    } catch (error) { setError(error instanceof Error ? error.message : '上传失败'); }
    finally { setBusy(false); }
  }
  function moveShot(e: number, s: number, direction: number) {
    if (!draft) return; const next = structuredClone(draft); const shots = next.episodes[e]!.shots;
    if (!shots[s + direction]) return; [shots[s], shots[s + direction]] = [shots[s + direction]!, shots[s]!]; setDraft(next);
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Film className="size-4" />创意 → 角色 → 分镜 → 制作 → 成片</div>
      <Link href="/learn" className="flex items-center gap-2 text-sm text-[color:var(--signal)]"><BookOpen className="size-4" />跟着 B 站教程做</Link>
    </div>
    {!signedIn ? <section className="border border-border bg-card/60 p-6">
      <h2 className="text-lg font-medium">开始你的第一集漫剧</h2><p className="my-3 text-sm text-muted-foreground">登录后保存剧本、上传角色素材并启动制作。教程无需登录即可观看。</p>
      <a href={signInPath} target="_top" className="text-[color:var(--signal)] underline">登录后开始创作</a>
    </section> : <>
      <div className="flex flex-wrap gap-3">
        <select aria-label="选择漫剧项目" className={`${field} max-w-sm`} value={id} disabled={busy || Boolean(dirty)} onChange={(e) => { setId(e.target.value); setRecord(null); setDraft(null); receivedVersion.current = ''; window.history.replaceState(null, '', e.target.value ? `/drama?projectId=${e.target.value}` : '/drama'); }}>
          <option value="">新建漫剧</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title} · {project.status}</option>)}
        </select>
        <Button variant="outline" disabled={busy} onClick={() => void refresh().catch((e) => setError(e.message))}>刷新状态</Button>
      </div>
      {!id ? <section className="border border-border bg-card/60 p-5">
        <label htmlFor="drama-idea" className="text-lg font-medium">你想讲一个什么故事？</label>
        <textarea id="drama-idea" className={`${field} mt-4 min-h-40`} value={idea} maxLength={12000} onChange={(e) => setIdea(e.target.value)} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">建议从 1 集、3–6 个镜头开始。可以指定风格、横竖屏、角色和对白。</span>
          <Button disabled={busy || idea.trim().length < 2} onClick={() => void action({ idea }, true)}><Sparkles className="size-4" />生成剧本与分镜</Button></div>
      </section> : null}
      {error || record?.error ? <p role="alert" className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{error || record?.error}</p> : null}
      {active ? <output className="flex items-center gap-3 border border-[color:var(--signal)]/30 p-4 text-sm"><LoaderCircle className="size-4 animate-spin" />
        {record?.status === 'GENERATING' ? '正在创作剧本与分镜，可离开页面后回来查看。' : record?.status === 'REVISING' ? '正在生成修改提案，现有版本保持可用。' : `${latestRun?.message} · ${latestRun?.completed}/${latestRun?.total}`}
        {latestRun?.status === 'RUNNING' ? <Button variant="outline" disabled={busy} onClick={() => void action({ action: 'cancel' })}>停止制作</Button> : null}
      </output> : null}
      {record && !draft && record.status === 'FAILED' ? <Button disabled={busy} onClick={() => void action({ action: 'propose', text: record.idea })}>重新生成剧本</Button> : null}
      {draft && record?.document ? <>
        <section className="border border-border bg-card/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{record.document.title} <span className="text-xs font-normal text-muted-foreground">v{record.document.version}</span></h2>
            <span className="text-xs text-muted-foreground">{draft.episodes.length} 集 · {shotCount} 镜头 · 计划 {seconds} 秒</span></div>
          <label htmlFor="drama-change" className="mt-5 block text-sm">用自然语言继续修改</label>
          <textarea id="drama-change" className={`${field} mt-2 min-h-24`} placeholder="例如：把第二个镜头改成信封特写，台词更简短，保留结尾悬念。" value={change} onChange={(e) => setChange(e.target.value)} />
          <Button className="mt-3" variant="outline" disabled={busy || active || Boolean(dirty) || change.trim().length < 2}
            onClick={() => void action({ action: 'propose', text: change })}>预览 AI 修改</Button>
          {record.proposal ? <div className="mt-4 border border-[color:var(--signal)]/30 p-4">
            <p className="text-sm">修改提案：{record.proposal.content.title} · {record.proposal.content.episodes.reduce((n, e) => n + e.shots.length, 0)} 个镜头</p>
            <details className="mt-2 text-xs"><summary className="cursor-pointer">展开修改后的完整剧本</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify(record.proposal.content, null, 2)}</pre></details>
            <Button className="mt-3" disabled={busy || active || Boolean(dirty)} onClick={() => void action({ action: 'apply', expectedVersion: record.document!.version })}>应用为新版本</Button>
          </div> : null}
        </section>
        <div role="tablist" aria-label="漫剧制作步骤" className="flex flex-wrap gap-2">
          {([['script', '剧本与分镜'], ['characters', '角色与声音'], ['output', '制作与成片'], ['learn', '对应教程']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key}
            className={`border px-4 py-2 text-sm ${tab === key ? 'border-[color:var(--signal)] text-[color:var(--signal)]' : 'border-border text-muted-foreground'}`} onClick={() => setTab(key)}>{label}</button>)}
        </div>
        {tab === 'script' ? <fieldset disabled={busy || active} className="space-y-4">
          <div className="grid gap-4 border border-border p-5 md:grid-cols-2">
            <label className="text-sm">片名<input className={`${field} mt-2`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="text-sm">画幅<select className={`${field} mt-2`} value={draft.aspectRatio} onChange={(e) => setDraft({ ...draft, aspectRatio: e.target.value as DramaContent['aspectRatio'] })}><option>16:9</option><option>9:16</option></select></label>
            <label className="text-sm md:col-span-2">全片视觉风格<textarea className={`${field} mt-2 min-h-24`} value={draft.visualStyle} onChange={(e) => setDraft({ ...draft, visualStyle: e.target.value })} /></label>
          </div>
          {draft.episodes.map((episode, e) => <section key={episode.id} className="space-y-3">
            <h3 className="text-lg font-medium">第 {e + 1} 集 · {episode.title}</h3>
            {episode.shots.map((shot, s) => <article key={shot.id} className="border border-border bg-card/60 p-5">
              <div className="flex items-center justify-between"><span className="text-sm text-[color:var(--signal)]">{String(s + 1).padStart(2, '0')} · {shot.id}</span><div className="flex gap-3 text-xs"><button disabled={s === 0} onClick={() => moveShot(e, s, -1)}>↑ 上移</button><button disabled={s === episode.shots.length - 1} onClick={() => moveShot(e, s, 1)}>↓ 下移</button></div></div>
              <label className="mt-3 block text-xs">画面描述<textarea className={`${field} mt-2 min-h-24`} value={shot.description} onChange={(event) => updateShot(e, s, { description: event.target.value })} /></label>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]"><label className="text-xs">景别与运镜<input className={`${field} mt-2`} value={shot.camera} onChange={(event) => updateShot(e, s, { camera: event.target.value })} /></label>
                <label className="text-xs">计划时长（秒）<input className={`${field} mt-2`} type="number" min={2} max={15} value={shot.durationSeconds} onChange={(event) => updateShot(e, s, { durationSeconds: Number(event.target.value) })} /></label></div>
              <label className="mt-3 block text-xs">镜头首帧（本地 Wan 必填；上传已确认人物、座次和构图的单张场景图）<input className="mt-2 block" type="file" accept="image/png,image/jpeg" onChange={(event) => void uploadFirstFrame(e, s, event.target.files?.[0])} /></label>
              {shot.firstFrameAssetId ? <div><Image unoptimized width={512} height={288} className="mt-2 max-h-48 object-contain" alt={`${shot.id}镜头首帧`} src={assetUrl(shot.firstFrameAssetId)} /><button className="text-xs underline" onClick={() => updateShot(e, s, { firstFrameAssetId: '' })}>移除首帧</button></div> : null}
              <div className="mt-3 space-y-2">{shot.dialogue.map((line, i) => <label key={i} className="block text-xs">{draft.characters.find((c) => c.id === line.characterId)?.name ?? line.characterId} 的对白
                <input className={`${field} mt-1`} value={line.text} onChange={(event) => updateShot(e, s, { dialogue: shot.dialogue.map((d, index) => index === i ? { ...d, text: event.target.value } : d) })} /></label>)}</div>
            </article>)}
          </section>)}
        </fieldset> : null}
        {tab === 'characters' ? <fieldset disabled={busy || active} className="grid gap-4 md:grid-cols-2">
          {!draft.characters.length ? <p className="text-sm text-muted-foreground">这是无角色的画面叙事，无需配置声音。</p> : null}
          {draft.characters.map((character, i) => <article key={character.id} className="space-y-3 border border-border bg-card/60 p-5">
            <h3 className="text-lg font-medium">{character.name}</h3>
            <label className="block text-xs">固定外貌与服装<textarea className={`${field} mt-2 min-h-24`} value={character.appearance} onChange={(e) => updateCharacter(i, { appearance: e.target.value })} /></label>
            <label className="block text-xs">参考图（PNG / JPEG，20 MB 内）<input className="mt-2 block w-full text-xs" type="file" accept="image/png,image/jpeg" onChange={(e) => void upload(i, e.target.files?.[0], 'image')} /></label>
            {character.referenceImageAssetId ? <div><Image unoptimized width={640} height={480} alt={`${character.name}的角色参考图`} className="h-40 w-full object-contain" src={assetUrl(character.referenceImageAssetId)} /><button className="text-xs underline" onClick={() => updateCharacter(i, { referenceImageAssetId: '' })}>移除参考图</button></div> : null}
            <p className="text-xs leading-5 text-muted-foreground">参考图传给视频服务。分镜预演使用文字设定生成图片，不能保证严格的角色一致性。</p>
            <label className="block text-xs">参考声音（WAV，20 MB 内）<input className="mt-2 block w-full text-xs" type="file" accept="audio/wav,.wav" onChange={(e) => void upload(i, e.target.files?.[0], 'voice')} /></label>
            {character.voiceReferenceAssetId ? <><audio className="w-full" controls src={assetUrl(character.voiceReferenceAssetId)}><track kind="captions" label="参考文字" srcLang="zh" src={`data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00:00.000 --> 00:05:00.000\n${character.referenceTranscript.replace(/[<>\r\n]/g, " ")}\n`)}`} /></audio><button className="text-xs underline" onClick={() => updateCharacter(i, { voiceReferenceAssetId: '', rightsConfirmed: false })}>移除参考声音</button>
              <label className="block text-xs">参考音频中实际说的文字<textarea className={`${field} mt-2 min-h-24`} value={character.referenceTranscript} onChange={(e) => updateCharacter(i, { referenceTranscript: e.target.value })} /></label></>
              : <label className="block text-xs">或填写已在声音服务注册的音色 ID<input className={`${field} mt-2`} value={character.voiceId} onChange={(e) => updateCharacter(i, { voiceId: e.target.value, rightsConfirmed: false })} placeholder="没有预设音色时，请上传参考声音" /></label>}
            <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={character.rightsConfirmed} onChange={(e) => updateCharacter(i, { rightsConfirmed: e.target.checked })} />我确认有权使用所选声音及上传的参考素材。</label>
          </article>)}
        </fieldset> : null}
        {tab === 'output' ? <div className="space-y-5">
          <section className="border border-border bg-card/60 p-5">
            <h3 className="font-medium">制作整集</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">本次最多制作 {shotCount} 个镜头，视频计划时长 {seconds} 秒。请选择本地 Wan 或云端 Seedance，失败不会自动切换引擎。已完成镜头仅在输入和引擎一致时复用。当前工作台将配音单独合成，不保证嘴型同步。</p>
            <label className="mt-4 block text-sm">背景音乐（可选；留空不生成配乐）<input className={`${field} mt-2`} value={musicPrompt} maxLength={1000} placeholder="例如：轻柔的钢琴，带一点悬疑感，无人声" onChange={(e) => setMusicPrompt(e.target.value)} /></label>
            {musicPrompt ? <p className="mt-2 text-xs text-muted-foreground">额外调用 {draft.episodes.length} 次配乐生成，混音时会降低背景音乐音量。</p> : null}
            {mode === 'VIDEO' ? <label className="mt-4 block text-sm">视频引擎<select aria-label="视频引擎" className={`${field} mt-2 max-w-sm`} disabled={busy || active} value={videoBackend} onChange={(e) => setVideoBackend(e.target.value as typeof videoBackend)}><option value="WAN">本地 Wan 2.2 · 不调用视频云额度</option><option value="SEEDANCE">云端 Seedance · 使用账户额度</option></select></label> : null}
            {mode === 'VIDEO' && videoBackend === 'WAN' ? <p className="mt-2 text-xs text-muted-foreground">本机安全试制档：每镜2–4秒、原始512×288（竖屏互换；MLX 24fps，ComfyUI 8fps）。需要逐镜首帧；没有原生对白或口型同步，后期配音不等于对口型。背景音乐是独立服务，填写后仍可能产生云端费用。</p> : null}
            <div className="mt-4 flex flex-wrap gap-3"><select aria-label="制作方式" className={`${field} max-w-xs`} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="VIDEO">AI 视频 · 调用视频服务</option><option value="STORYBOARD">分镜预演 · 静帧 + 配音</option></select>
              <Button disabled={busy || active || Boolean(dirty)} onClick={() => void action({ action: 'render', mode, ...(mode === 'VIDEO' ? { videoBackend } : {}), musicPrompt, maxShots: shotCount, expectedVersion: record.document!.version })}>开始制作 {shotCount} 个镜头</Button></div>
            {dirty ? <p className="mt-2 text-xs text-amber-200">请先保存下面的修改，再开始制作。</p> : null}
          </section>
          {[...record.renders].reverse().map((run) => <section key={run.id} className="border border-border p-5">
            <p className="text-sm">v{run.version} · {run.mode === 'VIDEO' ? `AI 视频 · ${run.videoBackend ?? '历史引擎'}` : '分镜预演'} · {run.status} · {run.completed}/{run.total}</p>
            <p className="mt-2 text-xs text-muted-foreground">{run.message}</p>
            {run.version !== record.document!.version ? <p className="mt-2 text-xs text-amber-200">这是历史版本的成片。</p> : null}
            {run.episodes.map((episode) => <div key={episode.id} className="mt-4">
              <h4 className="mb-3 text-sm">{episode.title} · {episode.duration.toFixed(1)} 秒</h4>
              <video className="max-h-[560px] w-full bg-black" controls preload="metadata" src={assetUrl(episode.video)}>
                <track default={!episode.burnedSubtitles} kind="captions" srcLang="zh" label="中文字幕" src={assetUrl(episode.subtitle)} />
              </video>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-[color:var(--signal)]"><a className="flex items-center gap-2" href={assetUrl(episode.video, true)}><Download className="size-4" />下载 MP4</a><a href={assetUrl(episode.subtitle, true)}>下载字幕 VTT</a></div>
            </div>)}
          </section>)}
        </div> : null}
        {tab === 'learn' ? <DramaTutorials onUse={(prompt) => { setChange(prompt); setTab('script'); }} /> : null}
        <div className="sticky bottom-3 flex flex-wrap items-center gap-3 border border-border bg-background/95 p-4 shadow-xl">
          <Button disabled={busy || active || !dirty} onClick={() => void action({ action: 'save', content: draft, expectedVersion: record.document!.version })}>保存为新版本</Button>
          <span className="text-xs text-muted-foreground">{dirty ? '有未保存的修改' : `已保存 · v${record.document.version}`}</span>
          <select aria-label="恢复历史版本" className={`${field} ml-auto max-w-xs`} value="" disabled={busy || active || Boolean(dirty)} onChange={(e) => {
            if (e.target.value) void action({ action: 'rollback', targetVersion: Number(e.target.value), expectedVersion: record.document!.version });
          }}><option value="">恢复历史版本…</option>{record.versions.filter((v) => v.version !== record.document!.version).map((v) => <option key={v.version} value={v.version}>v{v.version} · {v.title}</option>)}</select>
        </div>
      </> : null}
    </>}
  </div>;
}
