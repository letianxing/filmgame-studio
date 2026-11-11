'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Clapperboard,
  Sparkles,
  Film,
  Play,
  Check,
  Download,
  ArrowRight,
  RefreshCw,
  Plus,
  Users,
  WandSparkles,
  ChevronLeft,
  LoaderCircle,
} from 'lucide-react';
import type { ComicStory } from '../../../packages/comic-engine/src/index';
import type {
  ComicProject,
  ShotRun,
} from '../../orchestrator/src/comic-service';
import type { DreaminaModel } from '../../../services/dreamina-adapter/src/index';
import './comic-studio.css';
import { HarnessPanel } from './harness-panel';
import type { harnessProgress } from '../../orchestrator/src/comic-harness';

type Project = Omit<ComicProject, 'runs' | 'exports'> & {
  harness?: ReturnType<typeof harnessProgress>;
  exports: Array<ComicProject['exports'][number] & { stale?: boolean }>;
  busy: boolean;
  runs: Array<ShotRun & { stale?: boolean }>;
};
const labels: Record<string, string> = {
  DRAFT: '待准备',
  QUOTED: '已准备',
  SUBMITTING: '正在提交',
  RUNNING: '生成中',
  REVIEW: '待审片',
  APPROVED: '已通过',
  FAILED: '失败',
  REJECTED: '人工拒收',
  UNCERTAIN: '待核对',
  HEALTHY: '可用',
  UNAVAILABLE: '未连接',
  DEGRADED: '需检查',
  UNCONFIGURED: '未配置',
  LOGIN_REQUIRED: '请登录',
};
type ApiPayload = {
  project: Project;
  projects: Array<{ id: string; title: string; phase: string }>;
  models: DreaminaModel[];
  error?: string;
};
async function api<T = ApiPayload>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api/comic/${route}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const result = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(result.error ?? `请求失败 ${res.status}`);
  return result;
}
export function ComicStudio() {
  const [projects, setProjects] = useState<
    Array<{ id: string; title: string; phase: string }>
  >([]);
  const [project, setProject] = useState<Project | null>(null);
  const [health, setHealth] = useState<Record<string, string>>({});
  const [models, setModels] = useState<DreaminaModel[]>([]);
  const [tab, setTab] = useState('idea');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idea, setIdea] = useState('');
  const [style, setStyle] = useState('精致国漫，电影感光影，细腻人物表演');
  const [count, setCount] = useState(1);
  const [seconds, setSeconds] = useState(60);
  const [ratio, setRatio] = useState('9:16');
  const [draft, setDraft] = useState<ComicStory | null>(null);
  const [command, setCommand] = useState('');
  const [provider, setProvider] = useState<'dreamina' | 'seedance'>('dreamina');
  const [model, setModel] = useState('seedance_2.5');
  const [episode, setEpisode] = useState(0);
  const [shotIndex, setShotIndex] = useState(0);
  const [ceiling, setCeiling] = useState<Record<string, number>>({});
  const [quoteEvidence, setQuoteEvidence] = useState<Record<string, string>>({});
  const draftSignature = useRef('');
  const load = useCallback(async (id: string) => {
    const r = await api(`projects/${id}`);
    setProject(r.project);
    const signature = JSON.stringify([
      id,
      r.project.storyVersion,
      r.project.proposal,
    ]);
    if (signature !== draftSignature.current) {
      draftSignature.current = signature;
      setDraft(r.project.proposal ?? r.project.story ?? null);
    }
    return r.project;
  }, []);
  const list = useCallback(
    async () => setProjects((await api('projects')).projects),
    [],
  );
  const check = useCallback(async () => {
    setHealth(await api<Record<string, string>>('health'));
    try {
      setModels((await api('models')).models);
    } catch {
      setModels([]);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void list().catch((e) => setError(e.message));
      void check().catch((e) => setError(e.message));
      const query = new URLSearchParams(window.location.search);
      const requestedProject = query.get('project');
      if (requestedProject && /^[a-f0-9-]{36}$/.test(requestedProject)) {
        void load(requestedProject).catch((e) => setError(e.message));
        if (query.get('tab') === 'export') setTab('export');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [list, check, load]);
  const activeId = project?.id;
  useEffect(() => {
    if (!activeId) return;
    const id = activeId;
    const timer = setInterval(() => {
      void load(id).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [activeId, load]);
  const work = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await list();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const action = async (name: string, body: unknown = {}) => {
    if (!project) return;
    const result = await api(`projects/${project.id}/${name}`, body);
    if (result.project) setProject(result.project);
    await load(project.id);
  };
  const locked = busy || project?.busy;
  const story = project?.story;
  const ep = story?.episodes[episode];
  const shot = ep?.shots[shotIndex];
  const run = shot
    ? [...(project?.runs ?? [])].reverse().find((r) => r.shotId === shot.id)
    : undefined;
  const asset = (file: string) =>
    `/api/comic/projects/${project!.id}/assets/${file}`;
  const updateDraft = (fn: (d: ComicStory) => void) => {
    if (!draft) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };
  const selectProject = (id: string) =>
    work(async () => {
      const p = await load(id);
      setDraft(p.proposal ?? p.story ?? null);
      setEpisode(0);
      setShotIndex(0);
      setTab(p.story || p.proposal ? 'story' : 'idea');
    });
  return (
    <main className="comic-app">
      <aside className="comic-sidebar">
        <Link href="/comic" className="comic-brand">
          <span>
            <Clapperboard size={21} />
          </span>
          <div>
            FilmGame <b>STUDIO</b>
          </div>
        </Link>
        <div className="comic-mode">
          <Film size={16} /> 漫剧创作台 <span>LINEAR</span>
        </div>
        <nav>
          {[
            ['idea', '创意', Sparkles],
            ['story', '剧本与角色', Users],
            ['production', '镜头制作', Clapperboard],
            ['export', '整集交付', Film],
          ].map(([id, label, Icon]) => {
            const I = Icon as typeof Film;
            return (
              <button
                key={String(id)}
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(String(id))}
              >
                <I size={17} />
                {String(label)}
                <ArrowRight size={13} />
              </button>
            );
          })}
        </nav>
        <div className="comic-projects">
          <div className="comic-section-label">
            我的作品{' '}
            <button
              title="新建作品"
              onClick={() => {
                setProject(null);
                setDraft(null);
                setTab('idea');
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              className={project?.id === p.id ? 'selected' : ''}
              onClick={() => void selectProject(p.id)}
            >
              <span>{p.title}</span>
              <small>{p.phase}</small>
            </button>
          ))}
          {!projects.length && (
            <p className="comic-muted">从第一个故事开始。</p>
          )}
        </div>
        <Link className="comic-back" href="/">
          <ChevronLeft size={14} /> 影游工作台
        </Link>
        <div className="comic-services">
          <div className="comic-section-label">
            制作服务{' '}
            <button title="检查连接" onClick={() => void work(check)}>
              <RefreshCw size={14} />
            </button>
          </div>
          {[
            ['llm', '编剧'],
            ['dreamina', '即梦画布'],
            ['video', 'Seedance API'],
            ['media', '成片合成'],
          ].map(([key, name]) => (
            <div key={key}>
              <span>
                <i className={health[key!] === 'HEALTHY' ? 'good' : ''} />
                {name}
              </span>
              <small>{labels[health[key!] ?? ''] ?? '检查中'}</small>
            </div>
          ))}
        </div>
      </aside>
      <div className="comic-main">
        <header className="comic-top">
          <span>
            工作空间 <span>/</span> {project?.title ?? '新作品'}
          </span>
          <div>
            {project && (
              <span className="comic-pill">
                版本 {project.storyVersion || '草稿'}
              </span>
            )}
            <span className="comic-local">本地工作空间</span>
          </div>
        </header>
        <div className="comic-content">
          {project?.harness && <HarnessPanel key={project.id} projectId={project.id} progress={project.harness} asset={asset} action={action} disabled={Boolean(locked)} />}
          {project?.story && <p><a href={`/api/comic/projects/${project.id}/reviewed-manifest`} download={`${project.id}-reviewed-media.json`}>下载已审核素材交付清单</a><small> · 所有镜头须通过当前版本人工审核；这是素材清单，不代表 runtime 验收。</small></p>}
          <div className="comic-heading">
            <div>
              <p className="comic-eyebrow">STORY TO SCREEN</p>
              <h1>
                {
                  (
                    {
                      idea: '让故事，成为一部漫剧。',
                      story: '先把故事讲好。',
                      production: '每一个镜头，都有自己的表达。',
                      export: '从镜头，到完整作品。',
                    } as Record<string, string>
                  )[tab]
                }
              </h1>
              <p>创意、人物、分镜与原生音画，在同一个工作台完成。</p>
            </div>
            <span className="comic-tag">纯漫剧 · 无交互分支</span>
          </div>
          {(error || project?.error) && (
            <div role="alert" className="comic-error">
              {error || project?.error}
              <button onClick={() => setError('')}>×</button>
            </div>
          )}
          {project?.busy && (
            <div className="comic-progress">
              <LoaderCircle size={16} className="spin" />
              {project.phase}，可以保留此页面等待完成。
            </div>
          )}
          <div className="comic-flow">
            {['创意', '角色与分集', '镜头', '音画生成', '审片', '整集'].map(
              (s, i) => (
                <span key={s}>
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  {s}
                  {i < 5 && <ArrowRight size={13} />}
                </span>
              ),
            )}
          </div>
          {tab === 'idea' && (
            <div className="comic-idea-grid">
              <section className="comic-panel">
                <div className="comic-panel-title">
                  <Sparkles size={18} />
                  <h2>描述你的故事</h2>
                </div>
                <p className="comic-muted">
                  告诉我们人物、冲突、世界观和你期待的情绪。不需要编写技术提示词。
                </p>
                <textarea
                  aria-label="故事创意"
                  className="comic-idea"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="一位能听见旧物记忆的少女，在雨夜收到一封来自未来的信。她必须在黎明前找到寄信人，却发现线索指向十年前失踪的自己……"
                />
                <div className="comic-form-row">
                  <label>
                    集数
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    每集时长（秒）
                    <input
                      type="number"
                      min={15}
                      max={600}
                      value={seconds}
                      onChange={(e) => setSeconds(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    画幅
                    <select
                      value={ratio}
                      onChange={(e) => setRatio(e.target.value)}
                    >
                      <option value="9:16">9:16 竖屏</option>
                      <option value="16:9">16:9 横屏</option>
                      <option value="1:1">1:1 方形</option>
                    </select>
                  </label>
                </div>
                <label>
                  视觉风格
                  <input
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                  />
                </label>
                <div className="comic-actions">
                  <span>先生成可编辑方案，再制作视频。</span>
                  <button
                    className="comic-primary"
                    disabled={locked || idea.trim().length < 10}
                    onClick={() =>
                      void work(async () => {
                        const r = await api('projects', {
                          idea,
                          style,
                          ratio,
                          episodeCount: count,
                          episodeSeconds: seconds,
                        });
                        setProject(r.project);
                        setTab('story');
                        await api(`projects/${r.project.id}/design`, {});
                        await load(r.project.id);
                      })
                    }
                  >
                    <WandSparkles size={16} /> 生成漫剧方案{' '}
                    <ArrowRight size={16} />
                  </button>
                </div>
                {project && !project.story && !project.proposal && (
                  <button
                    disabled={locked}
                    onClick={() => void work(() => action('design'))}
                  >
                    继续设计当前作品
                  </button>
                )}
              </section>
              <aside className="comic-idea-aside">
                <div className="comic-poster">
                  <span>
                    YOUR NEXT
                    <br />
                    STORY
                    <br />
                    <em>STARTS HERE.</em>
                  </span>
                  <div className="comic-poster-line" />
                  <small>FILMGAME / COMIC STUDIO</small>
                </div>
                <h3>人物有记忆，故事有延续。</h3>
                <p>
                  角色参考图贯穿每个镜头；即梦与 Seedance
                  可按镜头选择；原生对白、环境音和配乐随画面一起生成。
                </p>
              </aside>
            </div>
          )}
          {tab === 'story' &&
            (!draft ? (
              <div className="comic-empty">
                <Users size={38} />
                <h2>{project ? project.phase : '先写下你的创意'}</h2>
                <p>完成创意后，这里将出现角色、分集和镜头。</p>
                {project && (
                  <button
                    disabled={locked}
                    onClick={() => void work(() => action('design'))}
                  >
                    生成剧本方案
                  </button>
                )}
              </div>
            ) : (
              <>
                <section className="comic-panel">
                  <div className="comic-panel-title">
                    <h2>
                      {project?.proposal ? '方案预览 · 等待确认' : '剧本编辑'}
                    </h2>
                    <span className="comic-pill">
                      {draft.episodes.length} 集 ·{' '}
                      {draft.episodes.reduce((n, e) => n + e.shots.length, 0)}{' '}
                      个镜头
                    </span>
                  </div>
                  {project?.proposal && project.story && (
                    <div className="comic-compare">
                      <div>
                        <small>当前版本</small>
                        <b>{project.story.title}</b>
                        <p>{project.story.logline}</p>
                        <small>
                          {project.story.episodes.reduce(
                            (n, e) => n + e.shots.length,
                            0,
                          )}{' '}
                          个镜头
                        </small>
                      </div>
                      <div>
                        <small>修改方案</small>
                        <b>{draft.title}</b>
                        <p>{draft.logline}</p>
                        <small>
                          {draft.episodes.reduce(
                            (n, e) => n + e.shots.length,
                            0,
                          )}{' '}
                          个镜头；确认后按依赖判定素材是否过期
                        </small>
                      </div>
                    </div>
                  )}
                  <label>
                    作品名称
                    <input
                      value={draft.title}
                      onChange={(e) =>
                        updateDraft((d) => {
                          d.title = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    故事梗概
                    <textarea
                      value={draft.logline}
                      onChange={(e) =>
                        updateDraft((d) => {
                          d.logline = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label>
                    统一画风
                    <input
                      value={draft.visualStyle}
                      onChange={(e) =>
                        updateDraft((d) => {
                          d.visualStyle = e.target.value;
                        })
                      }
                    />
                  </label>
                  <div className="comic-character-grid">
                    {draft.characters.map((c, i) => {
                      const job = [...(project?.runs ?? [])]
                        .reverse()
                        .find((r) => r.shotId === `character:${c.id}`);
                      const unchanged =
                        JSON.stringify(c) ===
                          JSON.stringify(
                            project?.story?.characters.find(
                              (x) => x.id === c.id,
                            ),
                          ) &&
                        draft.visualStyle === project?.story?.visualStyle;
                      return (
                        <div className="comic-character" key={c.id}>
                          {project?.references[c.id] && (
                            <Image
                              width={300}
                              height={180}
                              unoptimized
                              alt={c.name}
                              src={asset(project.references[c.id]!)}
                            />
                          )}
                          <label>
                            角色
                            <input
                              value={c.name}
                              onChange={(e) =>
                                updateDraft((d) => {
                                  d.characters[i]!.name = e.target.value;
                                })
                              }
                            />
                          </label>
                          <label>
                            外形与服装
                            <textarea
                              value={c.appearance}
                              onChange={(e) =>
                                updateDraft((d) => {
                                  d.characters[i]!.appearance = e.target.value;
                                })
                              }
                            />
                          </label>
                          <label>
                            声音设定
                            <input
                              value={c.voice}
                              onChange={(e) =>
                                updateDraft((d) => {
                                  d.characters[i]!.voice = e.target.value;
                                })
                              }
                            />
                          </label>
                          {project?.story && (
                            <label className="comic-upload">
                              {project.references[c.id]
                                ? '更换参考图'
                                : '上传角色参考图'}
                              <input
                                type="file"
                                accept="image/png,image/jpeg"
                                disabled={locked}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  void work(async () => {
                                    const data = await new Promise<string>(
                                      (resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onload = () =>
                                          resolve(
                                            (typeof reader.result === 'string'
                                              ? reader.result
                                              : ''
                                            ).split(',')[1]!,
                                          );
                                        reader.onerror = reject;
                                        reader.readAsDataURL(file);
                                      },
                                    );
                                    await action('reference', {
                                      characterId: c.id,
                                      mime: file.type,
                                      base64: data,
                                    });
                                  });
                                }}
                              />
                              <small>
                                PNG/JPEG，500KB以内；确认剧本后可上传
                              </small>
                            </label>
                          )}
                          {project?.story && (
                            <div className="comic-reference-controls">
                              <button
                                disabled={
                                  locked ||
                                  !unchanged ||
                                  [
                                    'RUNNING',
                                    'SUBMITTING',
                                    'UNCERTAIN',
                                  ].includes(job?.status ?? '')
                                }
                                onClick={() =>
                                  void work(() =>
                                    action('prepare-reference', {
                                      characterId: c.id,
                                    }),
                                  )
                                }
                              >
                                <Sparkles size={14} /> 即梦生成角色参考图
                              </button>
                              {!unchanged && (
                                <small>
                                  请先保存角色与画风修改，再准备参考图。
                                </small>
                              )}
                              {job && (
                                <small>
                                  {job.stale
                                    ? '角色设定已修改，请准备新图'
                                    : labels[job.status]}
                                </small>
                              )}
                              {job?.error && (
                                <p className="comic-error">{job.error}</p>
                              )}
                              {job?.status === 'QUOTED' && !job.stale && (
                                <button
                                  disabled={locked}
                                  onClick={() =>
                                    void work(() =>
                                      action('run', {
                                        runId: job.id,
                                        creditCeiling: job.credits,
                                      }),
                                    )
                                  }
                                >
                                  确认最多 {job.credits} 积分并生成
                                </button>
                              )}
                              {job &&
                                ['RUNNING', 'SUBMITTING', 'UNCERTAIN'].includes(
                                  job.status,
                                ) && (
                                  <button
                                    disabled={locked}
                                    onClick={() =>
                                      void work(() => action('sync'))
                                    }
                                  >
                                    同步参考图进度
                                  </button>
                                )}
                              {job?.file &&
                                job.status === 'REVIEW' &&
                                !job.stale && (
                                  <>
                                    <Image
                                      width={300}
                                      height={300}
                                      unoptimized
                                      alt={`${c.name} 待确认参考图`}
                                      src={asset(job.file)}
                                    />
                                    <button
                                      disabled={locked}
                                      onClick={() =>
                                        void work(() =>
                                          action('approve', {
                                            runId: job.id,
                                            sha256: job.sha256,
                                          }),
                                        )
                                      }
                                    >
                                      <Check size={14} /> 确认并锁定此形象
                                    </button>
                                  </>
                                )}
                              {project.canvas?.webUrl && (
                                <a
                                  href={project.canvas.webUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  查看即梦画布 ↗
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {draft.episodes.map((e, ei) => (
                    <details
                      className="comic-episode-editor"
                      key={e.id}
                      open={ei === 0}
                    >
                      <summary>
                        第 {ei + 1} 集 · {e.title}{' '}
                        <small>
                          {e.shots.length} 镜头 /{' '}
                          {e.shots.reduce((n, s) => n + s.durationSeconds, 0)}{' '}
                          秒
                        </small>
                      </summary>
                      <label>
                        分集标题
                        <input
                          value={e.title}
                          onChange={(ev) =>
                            updateDraft((d) => {
                              d.episodes[ei]!.title = ev.target.value;
                            })
                          }
                        />
                      </label>
                      <label>
                        剧情
                        <textarea
                          value={e.synopsis}
                          onChange={(ev) =>
                            updateDraft((d) => {
                              d.episodes[ei]!.synopsis = ev.target.value;
                            })
                          }
                        />
                      </label>
                      {e.shots.map((s, si) => (
                        <details key={s.id} className="comic-shot-editor">
                          <summary>
                            {String(si + 1).padStart(2, '0')} · {s.scene}
                            <small>{s.durationSeconds}秒</small>
                          </summary>
                          <div className="comic-form-row">
                            <label>
                              场景
                              <input
                                value={s.scene}
                                onChange={(ev) =>
                                  updateDraft((d) => {
                                    d.episodes[ei]!.shots[si]!.scene =
                                      ev.target.value;
                                  })
                                }
                              />
                            </label>
                            <label>
                              时长
                              <input
                                type="number"
                                min={4}
                                max={15}
                                value={s.durationSeconds}
                                onChange={(ev) =>
                                  updateDraft((d) => {
                                    d.episodes[ei]!.shots[si]!.durationSeconds =
                                      Number(ev.target.value);
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label>
                            动作与表演
                            <textarea
                              value={s.description}
                              onChange={(ev) =>
                                updateDraft((d) => {
                                  d.episodes[ei]!.shots[si]!.description =
                                    ev.target.value;
                                })
                              }
                            />
                          </label>
                          <label>
                            运镜
                            <input
                              value={s.camera}
                              onChange={(ev) =>
                                updateDraft((d) => {
                                  d.episodes[ei]!.shots[si]!.camera =
                                    ev.target.value;
                                })
                              }
                            />
                          </label>
                          {s.dialogue.map((line, li) => (
                            <div className="comic-dialogue" key={li}>
                              <span>
                                {
                                  draft.characters.find(
                                    (c) => c.id === line.characterId,
                                  )?.name
                                }
                              </span>
                              <input
                                aria-label="对白"
                                value={line.text}
                                onChange={(ev) =>
                                  updateDraft((d) => {
                                    d.episodes[ei]!.shots[si]!.dialogue[
                                      li
                                    ]!.text = ev.target.value;
                                  })
                                }
                              />
                              <input
                                aria-label="对白开始秒"
                                type="number"
                                value={line.startSeconds}
                                onChange={(ev) =>
                                  updateDraft((d) => {
                                    d.episodes[ei]!.shots[si]!.dialogue[
                                      li
                                    ]!.startSeconds = Number(ev.target.value);
                                  })
                                }
                              />
                              <input
                                aria-label="对白结束秒"
                                type="number"
                                value={line.endSeconds}
                                onChange={(ev) =>
                                  updateDraft((d) => {
                                    d.episodes[ei]!.shots[si]!.dialogue[
                                      li
                                    ]!.endSeconds = Number(ev.target.value);
                                  })
                                }
                              />
                            </div>
                          ))}
                        </details>
                      ))}
                    </details>
                  ))}
                  <div className="comic-actions">
                    <span>保存为新版本；原版本和素材保留。</span>
                    <button
                      className="comic-primary"
                      disabled={locked}
                      onClick={() =>
                        void work(async () => {
                          await action('apply', {
                            story: draft,
                            revision: project?.revision,
                          });
                          setTab('production');
                        })
                      }
                    >
                      <Check size={16} /> 确认并进入制作
                    </button>
                  </div>
                </section>
                <section className="comic-panel comic-command">
                  <h3>用自然语言修改</h3>
                  <textarea
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="让女主更果断，第二集结尾加一个反转，保留其他镜头。"
                  />
                  <button
                    disabled={
                      locked || !project?.story || command.trim().length < 2
                    }
                    onClick={() =>
                      void work(() => action('propose', { command }))
                    }
                  >
                    <Sparkles size={15} /> 预览修改方案
                  </button>
                  {(project?.storyVersion ?? 0) > 1 && (
                    <button
                      disabled={locked}
                      onClick={() =>
                        void work(() =>
                          action('restore', {
                            version: project!.storyVersion - 1,
                            revision: project!.revision,
                          }),
                        )
                      }
                    >
                      恢复上一剧本版本
                    </button>
                  )}
                </section>
              </>
            ))}
          {tab === 'production' &&
            (!story || !shot ? (
              <div className="comic-empty">
                <Clapperboard size={38} />
                <h2>确认剧本后开始制作</h2>
                <p>在“剧本与角色”中审核方案并确认。</p>
              </div>
            ) : (
              <>
                <div className="comic-production-bar">
                  <select
                    aria-label="选择分集"
                    value={episode}
                    onChange={(e) => {
                      setEpisode(Number(e.target.value));
                      setShotIndex(0);
                    }}
                  >
                    {story.episodes.map((e, i) => (
                      <option value={i} key={e.id}>
                        第{i + 1}集 · {e.title}
                      </option>
                    ))}
                  </select>
                  <div>
                    <span className="comic-pill">
                      {project!.ratio} · 原生音画
                    </span>
                    <button
                      disabled={locked}
                      onClick={() => void work(() => action('sync'))}
                    >
                      <RefreshCw size={14} /> 同步生成进度
                    </button>
                    {project?.canvas?.webUrl && (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={project.canvas.webUrl}
                      >
                        打开即梦画布 ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="comic-production-grid">
                  <div className="comic-shot-list">
                    {ep!.shots.map((s, i) => {
                      const r = [...project!.runs]
                        .reverse()
                        .find((r) => r.shotId === s.id);
                      return (
                        <button
                          className={i === shotIndex ? 'selected' : ''}
                          onClick={() => setShotIndex(i)}
                          key={s.id}
                        >
                          <b>{String(i + 1).padStart(2, '0')}</b>
                          <div>
                            <span>{s.scene}</span>
                            <small>
                              {s.durationSeconds}秒 ·{' '}
                              {r?.stale
                                ? '素材需更新'
                                : r
                                  ? labels[r.status]
                                  : '待制作'}
                            </small>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <section className="comic-panel">
                    <div
                      className="comic-preview"
                      style={{ aspectRatio: project!.ratio.replace(':', '/') }}
                    >
                      {run?.file && run.kind === 'REFERENCE' ? (
                        <Image src={asset(run.file)} alt="待审核的镜头构图" width={1920} height={1080} unoptimized style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : run?.file ? (
                        <video
                          key={run.file}
                          src={asset(run.file)}
                          controls
                          preload="metadata"
                        >
                          <track
                            kind="captions"
                            label="Chinese"
                            srcLang="zh"
                            src={shotCaptions(shot)}
                          />
                        </video>
                      ) : (
                        <div>
                          <Film size={44} />
                          <h3>镜头 {shotIndex + 1}</h3>
                          <p>
                            {run
                              ? labels[run.status]
                              : '准备好，让这个镜头动起来。'}
                          </p>
                        </div>
                      )}
                    </div>
                    <h2>{shot.scene}</h2>
                    <p>{shot.description}</p>
                    <p className="comic-muted">运镜 · {shot.camera}</p>
                    {shot.dialogue.map((d, i) => (
                      <blockquote key={i}>
                        <b>
                          {
                            story.characters.find((c) => c.id === d.characterId)
                              ?.name
                          }
                        </b>{' '}
                        {d.text}
                      </blockquote>
                    ))}
                    {run?.error && (
                      <div className="comic-error">{run.error}</div>
                    )}
                    {run?.stale && (
                      <div className="comic-error">
                        角色或镜头已修改，此视频不会用于新版本导出。
                      </div>
                    )}
                    {run?.status === 'REVIEW' && !run.stale && (
                      <button
                        className="comic-primary"
                        disabled={locked}
                        onClick={() =>
                          void work(() => action('approve', { runId: run.id, sha256: run.sha256 }))
                        }
                      >
                        <Check size={16} /> 画面、声音与连续性通过
                      </button>
                    )}
                  </section>
                  <aside className="comic-panel comic-settings">
                    <h3>制作节点</h3>
                    <label>
                      生成方式
                      <select
                        value={provider}
                        onChange={(e) =>
                          setProvider(e.target.value as 'dreamina' | 'seedance')
                        }
                      >
                        <option value="dreamina">即梦画布</option>
                        <option value="seedance">Seedance API</option>
                      </select>
                    </label>
                    {provider === 'dreamina' && (
                      <label>
                        视频模型
                        <select
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        >
                          {models
                            .filter((m) =>
                              [
                                'seedance_2.5',
                                'seedance_2.0_vip',
                                'seedance_2.0_fast',
                                'seedance_2.0_mini',
                              ].includes(m.model),
                            )
                            .map((m) => (
                              <option key={m.model} value={m.model}>
                                {m.model.replaceAll('_', ' ')}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <div className="comic-note">
                      <Check size={15} />
                      <span>
                        原生对白与环境声
                        <br />
                        <small>保留生成声音，不覆盖配音。</small>
                      </span>
                    </div>
                    <div className="comic-note">
                      <Users size={15} />
                      <span>
                        角色一致性
                        <br />
                        <small>
                          {
                            shot.characterIds.filter(
                              (c) => project!.references[c],
                            ).length
                          }
                          /{shot.characterIds.length} 个角色已绑定参考图
                        </small>
                      </span>
                    </div>
                    <button
                      disabled={
                        locked ||
                        ['RUNNING', 'SUBMITTING', 'UNCERTAIN'].includes(
                          run?.status ?? '',
                        )
                      }
                      onClick={() =>
                        void work(() =>
                          action('prepare', {
                            shotId: shot.id,
                            provider,
                            model,
                          }),
                        )
                      }
                    >
                      {run ? '准备新候选' : '准备此镜头'}{' '}
                      <ArrowRight size={14} />
                    </button>
                    {run?.status === 'QUOTED' && !run.stale && (
                      <div className="comic-quote">
                        <h4>
                          {run.provider === 'dreamina'
                            ? `即梦报价：${run.credits} 积分`
                            : 'Seedance API 制作'}
                        </h4>
                        {run.provider === 'dreamina' ? (
                          <label>
                            授权积分上限
                            <input
                              type="number"
                              min={run.credits}
                              value={ceiling[run.id] ?? run.credits ?? 0}
                              onChange={(e) =>
                                setCeiling({
                                  ...ceiling,
                                  [run.id]: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        ) : (
                          <div>
                            <p>生成 {shot.durationSeconds} 秒。填写你核对的费用上限；这不是供应商自动报价。</p>
                            <label>单次人民币上限<input type="number" min="0.01" step="0.01" value={ceiling[run.id] ?? ''} onChange={e => setCeiling({ ...ceiling, [run.id]: Number(e.target.value) })} /></label>
                            <label>报价依据<input maxLength={2000} value={quoteEvidence[run.id] ?? ''} onChange={e => setQuoteEvidence({ ...quoteEvidence, [run.id]: e.target.value })} /></label>
                          </div>
                        )}
                        <button
                          className="comic-primary"
                          disabled={locked}
                          onClick={() =>
                            void work(() =>
                              action('run', {
                                runId: run.id,
                                ...(run.provider === 'dreamina'
                                  ? {
                                      creditCeiling:
                                        ceiling[run.id] ?? run.credits,
                                    }
                                  : { currencyQuote: { ceiling: ceiling[run.id], evidence: quoteEvidence[run.id] } }),
                              }),
                            )
                          }
                        >
                          <Play size={15} /> 确认费用并生成
                        </button>
                      </div>
                    )}
                    <small className="comic-muted">
                      提交后点击“同步生成进度”取回结果。网络中断时保留原任务，避免重复生成。
                    </small>
                  </aside>
                </div>
              </>
            ))}
          {tab === 'export' && (
            <section className="comic-panel">
              <div className="comic-panel-title">
                <Film size={18} />
                <h2>分集交付</h2>
              </div>
              <p className="comic-muted">
                按剧本顺序拼接已通过的镜头，保留原生音轨，输出 MP4 与可编辑
                SRT。字幕使用剧本时间轴，请在发布前校对实际对白。
              </p>
              {!story && (
                <div className="comic-empty">还没有可导出的剧集。</div>
              )}
              {story?.episodes.map((e, i) => {
                const ready = e.shots.filter((s) =>
                  project!.runs.some(
                    (r) =>
                      r.shotId === s.id && r.status === 'APPROVED' && !r.stale,
                  ),
                ).length;
                const output = [...project!.exports]
                  .reverse()
                  .find(
                    (x) =>
                      x.episodeId === e.id &&
                      x.storyVersion === project!.storyVersion &&
                      !x.stale,
                  );
                return (
                  <div className="comic-export-row" key={e.id}>
                    <div>
                      <h3>
                        第 {i + 1} 集 · {e.title}
                      </h3>
                      <p>
                        {ready} / {e.shots.length} 镜头已通过
                      </p>
                      {output && (
                        <video
                          controls
                          preload="metadata"
                          src={asset(output.file)}
                        >
                          <track
                            kind="captions"
                            label="Chinese"
                            srcLang="zh"
                            src={`${asset(output.subtitles)}?format=vtt`}
                          />
                        </video>
                      )}
                    </div>
                    <div>
                      <button
                        className="comic-primary"
                        disabled={locked || ready !== e.shots.length}
                        onClick={() =>
                          void work(() => action('export', { episodeId: e.id }))
                        }
                      >
                        <Film size={15} /> 合成整集
                      </button>
                      {output && (
                        <>
                          <a href={`${asset(output.file)}?download=1`}>
                            <Download size={15} /> 下载 MP4
                          </a>
                          <a href={`${asset(output.subtitles)}?download=1`}>
                            下载字幕 SRT
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
        <footer className="comic-footer">
          <span>FILMGAME STUDIO</span>
          <span>让创作保持自由，让制作井然有序。</span>
        </footer>
      </div>
    </main>
  );
}

function shotCaptions(shot: ComicStory['episodes'][number]['shots'][number]) {
  const stamp = (s: number) => new Date(s * 1000).toISOString().slice(11, 23);
  return (
    'data:text/vtt;charset=utf-8,' +
    encodeURIComponent(
      'WEBVTT\n\n' +
        shot.dialogue
          .map(
            (d) =>
              `${stamp(d.startSeconds)} --> ${stamp(d.endSeconds)}\n${d.text}\n`,
          )
          .join('\n'),
    )
  );
}
