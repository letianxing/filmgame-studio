import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, stat, copyFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { LLMProvider } from "../../../packages/provider-sdk/src/index.js";
import {
  type ComicStory,
  type Ratio,
  validateComic,
  nativePrompt,
} from "../../../packages/comic-engine/src/index.js";
import { RemoteVideoProvider } from "../../../services/remote-video-adapter/src/index.js";
import {
  DreaminaAdapter,
  dreaminaNodeId,
  DreaminaPreflightError,
  DreaminaRejectedError,
} from "../../../services/dreamina-adapter/src/index.js";
import { MediaPipeline, type MediaTechnicalValidation, type MediaSignalAnalysis } from "../../../services/media-pipeline/src/index.js";
import { ComicWorkflow } from "./comic-workflow.js";
import { submissionGate, validateHarnessPolicy, type HarnessPolicy } from './comic-harness.js';
import { addBillingReceipt, billingSummary, type BillingReceipt } from './comic-cost-ledger.js';
import { cleanupRejected, type CleanupReceipt } from './comic-cleanup.js';
import { assertTextIntegrity } from './comic-text-integrity.js';

export interface ShotRun {
  id: string;
  shotId: string;
  kind?: "REFERENCE";
  provider: "seedance" | "dreamina" | "external";
  status:
    | "DRAFT"
    | "QUOTED"
    | "SUBMITTING"
    | "RUNNING"
    | "REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "FAILED"
    | "UNCERTAIN";
  storyVersion: number;
  inputHash: string;
  generationId?: string;
  nodeId?: string;
  updateId?: string;
  submitId?: string;
  credits?: number;
  creditCeiling?: number;
  currencyCeiling?: number;
  currencyQuoteEvidence?: string;
  model?: string;
  resourceId?: string;
  file?: string;
  sha256?: string;
  durationSeconds?: number;
  error?: string;
  createdAt: string;
  imported?: { sourceSha256: string; sourceLabel: string; importedAt: string; billing: 'HISTORICAL_EXTERNAL_LEDGER'; ledger: string };
  submittedAt?: string;
  completedAt?: string;
  reviewAcknowledgedSha?: string;
  reviewDecision?: { decision: 'APPROVED' | 'REJECTED'; sha256: string; inputHash: string; at: string; actor: 'LOCAL_CREATOR'; reason: string };
  cleanup?: CleanupReceipt;
  basicReview?: { sha256: string; checkedAt: string; technical: MediaTechnicalValidation; signals?: MediaSignalAnalysis; scope: 'TECHNICAL_ONLY' };
  referenceUploads?: Array<{ characterId: string; file: string; resourceId: string }>;
  adoptedFromRunId?: string;
  editorialTrim?: { startSeconds: number; endSeconds: number; reason: string };
}
export interface ComicProject {
  id: string;
  title: string;
  idea: string;
  style: string;
  ratio: Ratio;
  episodeCount: number;
  episodeSeconds: number;
  revision: number;
  storyVersion: number;
  createdAt: string;
  updatedAt: string;
  phase: string;
  error?: string;
  story?: ComicStory;
  proposal?: ComicStory;
  runs: ShotRun[];
  references: Record<string, string>;
  sceneConcepts?: Record<string, { prompt: string; refs: string[] }>;
  referenceNodes?: Record<string, { file: string; nodeId: string }>;
  shotReferences?: Record<string, Array<{ nodeId: string; file: string; sha256?: string; mediaType: 'image' | 'audio' | 'video'; role: string }>>;
  /** Explicit per-shot opt-in: staging already contains cast identity; omit global image references. */
  shotReferenceOnly?: Record<string, boolean>;
  creditBudget?: { ceiling: number; auxiliaryReserved: number };
  currencyBudget?: { ceiling: number };
  harnessPolicy?: HarnessPolicy;
  billingReceipts?: BillingReceipt[];
  canvas?: { projectId: string; webUrl?: string };
  exports: Array<{
    episodeId: string;
    file: string;
    subtitles: string;
    storyVersion: number;
    runIds: string[];
    createdAt: string;
  }>;
}
export interface ComicConfig {
  root: string;
  llm: LLMProvider | null;
  video: RemoteVideoProvider | null;
  dreamina: DreaminaAdapter | null;
  media: MediaPipeline;
}
export class ComicService {
  readonly busy = new Set<string>();
  constructor(readonly config: ComicConfig) {}
  async list() {
    await mkdir(this.config.root, { recursive: true });
    const entries = await readdir(this.config.root, { withFileTypes: true });
    const result: ComicProject[] = [];
    for (const e of entries)
      if (e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)) result.push(await this.get(e.name));
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  directory(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("无效项目");
    return path.join(this.config.root, id);
  }
  async get(id: string): Promise<ComicProject> {
    return JSON.parse(
      await readFile(path.join(this.directory(id), "project.json"), "utf8"),
    ) as ComicProject;
  }
  async save(p: ComicProject) {
    p.updatedAt = new Date().toISOString();
    p.revision++;
    await mkdir(this.directory(p.id), { recursive: true });
    const target = path.join(this.directory(p.id), "project.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(p, null, 2));
    await rename(temporary, target);
  }
  async create(input: {
    idea: string;
    style: string;
    ratio: Ratio;
    episodeCount: number;
    episodeSeconds: number;
  }) {
    if (input.idea.trim().length < 10 || input.idea.length > 12000)
      throw new Error("请用10至12000字描述故事");
    if (
      !["16:9", "9:16", "1:1"].includes(input.ratio) ||
      !Number.isInteger(input.episodeCount) ||
      input.episodeCount < 1 ||
      input.episodeCount > 24 ||
      !Number.isInteger(input.episodeSeconds) ||
      input.episodeSeconds < 15 ||
      input.episodeSeconds > 600 ||
      typeof input.style !== "string" ||
      input.style.length > 2000
    )
      throw new Error("创作参数无效");
    const now = new Date().toISOString();
    const p: ComicProject = {
      ...input,
      id: randomUUID(),
      title: "未命名漫剧",
      revision: 0,
      storyVersion: 0,
      createdAt: now,
      updatedAt: now,
      phase: "创意已保存",
      runs: [],
      references: {},
      exports: [],
    };
    await this.save(p);
    return p;
  }
  async exclusive<T>(id: string, fn: (p: ComicProject) => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new Error("当前项目有任务正在执行，请稍后");
    this.busy.add(id);
    try {
      return await fn(await this.get(id));
    } finally {
      this.busy.delete(id);
    }
  }
  async design(id: string) {
    return this.exclusive(id, async (p) => {
      if (!this.config.llm) throw new Error("未配置编剧服务");
      this.assertIdle(p);
      delete p.error;
      try {
        const story = await new ComicWorkflow(this.config.llm).generate(p, async (message) => {
          p.phase = message;
          await this.save(p);
        });
        p.proposal = story;
        p.phase = "分集与镜头方案待确认";
        await this.save(p);
      } catch (e) {
        p.phase = "设计未完成";
        p.error = message(e);
        await this.save(p);
      }
      return p;
    });
  }
  async apply(id: string, story: unknown, revision: number) {
    return this.exclusive(id, async (p) => {
      if (p.revision !== revision) throw new Error("版本已变化，请刷新后再保存");
      this.assertIdle(p);
      p.story = validateComic(story);
      p.storyVersion++;
      p.title = p.story.title;
      delete p.proposal;
      await mkdir(path.join(this.directory(id), "versions"), { recursive: true });
      await writeFile(
        path.join(this.directory(id), "versions", `${p.storyVersion}.json`),
        JSON.stringify(p.story, null, 2),
        { flag: "wx" },
      );
      p.phase = "镜头方案已确认";
      await this.save(p);
      return p;
    });
  }
  async propose(id: string, command: string) {
    return this.exclusive(id, async (p) => {
      if (!this.config.llm || !p.story) throw new Error("先完成剧本设计");
      this.assertIdle(p);
      const { comicSchema, schemaJson } =
        await import("../../../packages/comic-engine/src/index.js");
      const result = await this.config.llm.generateStructured(
        {
          system:
            "你是漫剧编剧。根据创作要求修改结构化剧本，保留未受影响实体的ID；只输出符合Schema的JSON。不得加入交互游戏。",
          prompt: JSON.stringify({ story: p.story, command, schema: comicSchema }),
          jsonSchema: schemaJson(comicSchema),
          maxOutputTokens: 24000,
        },
        {
          projectId: id,
          storyVersion: p.storyVersion,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
        },
      );
      p.proposal = validateComic(result.data);
      p.phase = "修改方案待确认";
      await this.save(p);
      return p;
    });
  }
  assertIdle(p: ComicProject) {
    if (p.runs.some((r) => ["SUBMITTING", "RUNNING", "UNCERTAIN"].includes(r.status)))
      throw new Error("请先同步执行中的镜头，再修改剧本");
  }
  shot(p: ComicProject, shotId: string) {
    const shot = p.story?.episodes.flatMap((e) => e.shots).find((s) => s.id === shotId);
    if (!shot || !p.story) throw new Error("镜头不存在，请先确认剧本");
    return { story: p.story, shot };
  }
  hash(p: ComicProject, shotId: string) {
    if (shotId.startsWith('scene:')) {
      const concept = p.sceneConcepts?.[shotId.slice(6)];
      if (!concept) throw new Error('场景构图不存在');
      return createHash('sha256').update(JSON.stringify({ concept, version: 1 })).digest('hex');
    }
    if (shotId.startsWith("character:")) {
      const character = p.story?.characters.find((c) => c.id === shotId.slice(10));
      if (!character) throw new Error("角色不存在");
      return createHash("sha256")
        .update(JSON.stringify({ character, style: p.story!.visualStyle, referencePromptVersion: 3 }))
        .digest("hex");
    }
    const { story, shot } = this.shot(p, shotId);
    return createHash("sha256")
      .update(
        JSON.stringify({
          shot,
          style: story.visualStyle,
          ratio: p.ratio,
          characters: story.characters.filter((c) => shot.characterIds.includes(c.id)),
          references: this.referenceCharacterIds(p, shotId).map((c) => p.references[c] ?? null),
          shotReferences: p.shotReferences?.[shotId] ?? [],
          ...(p.shotReferenceOnly?.[shotId] ? { shotReferenceOnly: true } : {}),
        }),
      )
      .digest("hex");
  }
  referenceCharacterIds(p: ComicProject, shotId: string): string[] {
    const { shot } = this.shot(p, shotId);
    if (!p.shotReferenceOnly?.[shotId]) return shot.characterIds;
    if (!p.shotReferences?.[shotId]?.some(r => r.mediaType === 'image'))
      throw new Error('仅使用本镜参考时必须提供包含人物身份的构图图片');
    return [];
  }
  exportIsCurrent(p: ComicProject, output: ComicProject["exports"][number]) {
    const episode = p.story?.episodes.find((e) => e.id === output.episodeId);
    return (
      !!episode &&
      output.storyVersion === p.storyVersion &&
      episode.shots.length === output.runIds.length &&
      episode.shots.every((s, i) => {
        const run = p.runs.find((r) => r.id === output.runIds[i]);
        return (
          run?.shotId === s.id && run.status === "APPROVED" && run.inputHash === this.hash(p, s.id)
        );
      })
    );
  }
  async prepare(id: string, shotId: string, provider: "seedance" | "dreamina", model?: string) {
    return this.exclusive(id, async (p) => {
      if (!["seedance", "dreamina"].includes(provider)) throw new Error("未知制作服务");
      const { story, shot } = this.shot(p, shotId);
      assertTextIntegrity(shot);
      assertTextIntegrity(nativePrompt(story, shot, { appearanceFromReference: !!p.shotReferenceOnly?.[shotId] }), 'compiledPrompt');
      const referenceCharacterIds = this.referenceCharacterIds(p, shotId);
      if (p.shotReferenceOnly?.[shotId] && provider !== 'dreamina')
        throw new Error('当前制作服务不支持仅使用本镜参考');
      if (
        p.runs.some(
          (r) => r.shotId === shotId && ["SUBMITTING", "RUNNING", "UNCERTAIN"].includes(r.status),
        )
      )
        throw new Error("此镜头仍在制作，请同步原任务");
      const run: ShotRun = {
        id: randomUUID(),
        shotId,
        provider,
        status: "DRAFT",
        storyVersion: p.storyVersion,
        inputHash: this.hash(p, shotId),
        createdAt: new Date().toISOString(),
      };
      p.runs.push(run);
      await this.save(p);
      if (provider === "dreamina") {
        const cli = this.requireDreamina();
        if (!(await cli.auth()).loggedIn) throw new Error("请先完成即梦登录");
        p.canvas ??= { projectId: randomUUID() };
        await this.save(p);
        if (!p.canvas.webUrl) {
          p.canvas = await cli.createCanvas(p.title, p.canvas.projectId);
          await this.save(p);
        }
        run.nodeId = dreaminaNodeId();
        run.updateId = randomUUID();
        run.submitId = randomUUID();
        run.model = model ?? "seedance_2.5";
        await this.save(p);
        const refs: string[] = [];
        const bindings: string[] = [];
        run.referenceUploads = referenceCharacterIds
          .filter((c) => p.references[c] && p.referenceNodes?.[c]?.file !== p.references[c])
          .map((characterId) => ({
            characterId,
            file: p.references[characterId]!,
            resourceId: randomUUID(),
          }));
        await this.save(p);
        for (const reference of run.referenceUploads) {
          const uploaded = await cli.call<{ resourceId: string }>([
            "resource",
            "upload",
            "--file",
            path.join(this.directory(id), reference.file),
            "--type",
            "image",
            "--project-id",
            p.canvas.projectId,
            "--resource-id",
            reference.resourceId,
          ]);
          refs.push(`res:${uploaded.resourceId}`);
          bindings.push(`${story.characters.find(c => c.id === reference.characterId)?.name}的外观严格使用 {{res:${uploaded.resourceId}}}，按角色设定识别参考中的对应人物，服装和面部不改变。`);
        }
        for (const c of referenceCharacterIds)
          if (p.referenceNodes?.[c] && p.referenceNodes[c]!.file === p.references[c])
            refs.push(`node:${p.referenceNodes[c]!.nodeId}`);
        const referenceTypes: Array<'image' | 'audio' | 'video'> = refs.map(() => 'image');
        bindings.push(...referenceCharacterIds.flatMap(c => p.referenceNodes?.[c]?.file === p.references[c] && p.referenceNodes?.[c]
          ? [`${story.characters.find(x => x.id === c)?.name}的外观严格使用 {{node:${p.referenceNodes[c]!.nodeId}}}，服装和面部不改变。`] : []));
        for (const reference of p.shotReferences?.[shotId] ?? []) {
          let refId = `node:${reference.nodeId}`;
          if (!reference.nodeId) {
            const local = path.join(this.directory(id), reference.file);
            if (!reference.sha256 || await checksum(local) !== reference.sha256)
              throw new Error('Adopted shot reference SHA changed');
            const upload = { characterId: `shot:${shotId}`, file: reference.file, resourceId: randomUUID() };
            run.referenceUploads.push(upload);
            await this.save(p);
            const uploaded = await cli.call<{ resourceId: string }>(['resource', 'upload', '--file', local,
              '--type', reference.mediaType, '--project-id', p.canvas.projectId, '--resource-id', upload.resourceId]);
            refId = `res:${uploaded.resourceId}`;
          }
          refs.push(refId);
          referenceTypes.push(reference.mediaType);
          bindings.push(`${reference.role}：{{${refId}}}。${reference.mediaType === 'audio' ? '仅作为指定角色音色参考，台词严格使用本镜头对白，不复述参考音频内容。' : '保持构图要求下的空间与物品特征。'}`);
        }
        await cli.saveVideo({
          canvasId: p.canvas.projectId,
          nodeId: run.nodeId,
          updateId: run.updateId,
          title: shot.id,
          prompt: [nativePrompt(story, shot, { appearanceFromReference: !!p.shotReferenceOnly?.[shotId] }), ...bindings].join('\n'),
          model: run.model,
          ratio: p.ratio,
          resolution: "720p",
          duration: shot.durationSeconds,
          refs,
          referenceTypes,
        });
        const quote = await cli.quote(p.canvas.projectId, run.nodeId);
        if (
          !quote.confirmable ||
          quote.items.length !== 1 ||
          quote.items[0]?.nodeId !== run.nodeId ||
          quote.items.some((i) => i.error || i.maxCredits === undefined) ||
          !Number.isFinite(quote.totalMaxCredits) ||
          quote.totalMaxCredits < 0
        )
          throw new Error("即梦无法完整报价，请在画布检查");
        run.credits = quote.totalMaxCredits;
      }
      run.status = "QUOTED";
      await this.save(p);
      return p;
    });
  }
  async prepareSceneReference(id: string, sceneId: string, prompt: string, refs: string[]) {
    if (!/^[a-z0-9_-]+$/.test(sceneId) || !prompt.trim() || prompt.length > 2000 || refs.length > 6)
      throw new Error('场景参考参数无效');
    return this.exclusive(id, async p => {
      this.assertIdle(p);
      const shotId = `scene:${sceneId}`;
      if (p.runs.some(r => r.shotId === shotId && ['DRAFT', 'QUOTED', 'REVIEW'].includes(r.status)))
        throw new Error('场景已有待处理任务，请先处理原任务');
      const cli = this.requireDreamina();
      if (!(await cli.auth()).loggedIn) throw new Error('请先完成即梦登录');
      p.sceneConcepts ??= {};
      p.sceneConcepts[sceneId] = { prompt, refs: [...refs] };
      p.canvas ??= { projectId: randomUUID() };
      await this.save(p);
      if (!p.canvas.webUrl) p.canvas = await cli.createCanvas(p.title, p.canvas.projectId);
      const run: ShotRun = { id: randomUUID(), shotId, kind: 'REFERENCE', provider: 'dreamina',
        status: 'DRAFT', storyVersion: p.storyVersion, inputHash: this.hash(p, shotId),
        createdAt: new Date().toISOString(), nodeId: dreaminaNodeId(), updateId: randomUUID(), submitId: randomUUID() };
      p.runs.push(run);
      await this.save(p);
      run.model = await cli.saveCharacter({ canvasId: p.canvas.projectId, nodeId: run.nodeId!,
        updateId: run.updateId!, title: `场景构图 ${sceneId}`, prompt, ratio: '16:9', refs });
      const quote = await cli.quote(p.canvas.projectId, run.nodeId!);
      if (!quote.confirmable || quote.items.length !== 1 || quote.items[0]?.nodeId !== run.nodeId
        || quote.items.some(i => i.error || i.maxCredits === undefined)
        || !Number.isFinite(quote.totalMaxCredits) || quote.totalMaxCredits < 0) throw new Error('即梦无法完整报价');
      run.credits = quote.totalMaxCredits;
      run.status = 'QUOTED';
      await this.save(p);
      return p;
    });
  }
  async prepareReference(id: string, characterId: string) {
    return this.exclusive(id, async (p) => {
      const character = p.story?.characters.find((c) => c.id === characterId);
      if (!character) throw new Error("请先保存角色设定");
      const shotId = `character:${characterId}`;
      if (
        p.runs.some(
          (r) => r.shotId === shotId && ["SUBMITTING", "RUNNING", "UNCERTAIN"].includes(r.status),
        )
      )
        throw new Error("角色参考图正在生成，请同步原任务");
      const cli = this.requireDreamina();
      if (!(await cli.auth()).loggedIn) throw new Error("请先完成即梦登录");
      p.canvas ??= { projectId: randomUUID() };
      await this.save(p);
      if (!p.canvas.webUrl) {
        p.canvas = await cli.createCanvas(p.title, p.canvas.projectId);
        await this.save(p);
      }
      const run: ShotRun = {
        id: randomUUID(),
        shotId,
        kind: "REFERENCE",
        provider: "dreamina",
        status: "DRAFT",
        storyVersion: p.storyVersion,
        inputHash: this.hash(p, shotId),
        createdAt: new Date().toISOString(),
        nodeId: dreaminaNodeId(),
        updateId: randomUUID(),
        submitId: randomUUID(),
      };
      p.runs.push(run);
      await this.save(p);
      run.model = await cli.saveCharacter({
        canvasId: p.canvas.projectId,
        nodeId: run.nodeId!,
        updateId: run.updateId!,
        title: character.name,
        prompt: `角色造型设定单人立绘，中性纯色背景，只画设定中的一个角色，没有其他人物、场景、文字或海报装饰。项目画风：${p.story!.visualStyle}。角色设定：${character.name}：${character.appearance}。严格保留设定的年龄、体型、物种、服饰、发型、装备与神态，不擅自改为成年人或添加补丁。全身站姿，头到足完整，面部与服装结构清楚，人物占画面高度85%。姿态与光照服务于角色设定和项目画风。`,
      });
      const quote = await cli.quote(p.canvas.projectId, run.nodeId!);
      if (
        !quote.confirmable ||
        quote.items.length !== 1 ||
        quote.items[0]?.nodeId !== run.nodeId ||
        quote.items.some((i) => i.error || i.maxCredits === undefined) ||
        !Number.isFinite(quote.totalMaxCredits) ||
        quote.totalMaxCredits < 0
      )
        throw new Error("即梦无法完整报价");
      run.credits = quote.totalMaxCredits;
      run.status = "QUOTED";
      delete p.error;
      await this.save(p);
      return p;
    });
  }
  async run(id: string, runId: string, ceiling?: number, currencyQuote?: { ceiling: number; evidence: string }) {
    return this.exclusive(id, async (p) => {
      const r = p.runs.find((r) => r.id === runId);
      if (!r || r.status !== "QUOTED") throw new Error("请先准备镜头并确认制作");
      assertTextIntegrity(this.shot(p, r.shotId).shot);
      const currentShot = this.shot(p, r.shotId);
      assertTextIntegrity(nativePrompt(currentShot.story, currentShot.shot,
        { appearanceFromReference: !!p.shotReferenceOnly?.[r.shotId] }), 'compiledPrompt');
      const gate = submissionGate(p, r);
      if (gate.length) throw new Error(gate.join('; '));
      if (r.inputHash !== this.hash(p, r.shotId)) throw new Error("镜头或角色已变化，请重新准备");
      if (r.provider === "seedance" && !this.config.video) throw new Error("未配置视频网关");
      if (r.provider === 'seedance') {
        if (!p.currencyBudget) throw new Error('请先设置火山人民币项目预算');
        if (!currencyQuote || !Number.isFinite(currencyQuote.ceiling) || currencyQuote.ceiling <= 0
          || currencyQuote.ceiling > 1e9 || Math.abs(currencyQuote.ceiling * 100 - Math.round(currencyQuote.ceiling * 100)) > 1e-5
          || typeof currencyQuote.evidence !== 'string' || !currencyQuote.evidence.trim() || currencyQuote.evidence.length > 2000)
          throw new Error('请填写已核对的单次人民币费用上限及报价依据');
        const budget = billingSummary(p, 'CNY', r.id);
        if (budget.unknownReservations || budget.committed + currencyQuote.ceiling > p.currencyBudget.ceiling)
          throw new Error('火山制作额度不足或存在待核对费用');
        r.currencyCeiling = currencyQuote.ceiling;
        r.currencyQuoteEvidence = currencyQuote.evidence.trim();
      }
      if (r.provider === 'dreamina' && !p.creditBudget) throw new Error('请先设置即梦项目积分预算');
      if (
        r.provider === "dreamina" &&
        (!Number.isInteger(ceiling) || ceiling! < (r.credits ?? Infinity))
      )
        throw new Error("请确认足够的即梦积分上限");
      if (r.provider === 'dreamina' && p.creditBudget) {
        const budget = billingSummary(p, 'DREAMINA_CREDIT', r.id);
        if (budget.unknownReservations || budget.committed + ceiling! > p.creditBudget.ceiling)
          throw new Error('制作额度不足，已保留其他任务可能占用的积分');
      }
      r.status = "SUBMITTING";
      r.submittedAt = new Date().toISOString();
      if (ceiling !== undefined) r.creditCeiling = ceiling;
      await this.save(p);
      try {
        if (r.provider === "dreamina")
          await this.requireDreamina().run(p.canvas!.projectId, r.nodeId!, r.submitId!, ceiling!);
        else {
          const { story, shot } = this.shot(p, r.shotId);
          if (!this.config.video) throw new Error("未配置视频网关");
          const refs = await Promise.all(
            shot.characterIds
              .filter((c) => p.references[c])
              .map(async (c) => {
                const name = p.references[c]!;
                const bytes = await readFile(path.join(this.directory(id), name));
                return `data:image/${name.endsWith(".png") ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
              }),
          );
          r.generationId = await this.config.video.submit(
            {
              prompt: nativePrompt(story, shot),
              durationSeconds: shot.durationSeconds,
              referenceAssetUris: refs,
              aspectRatio: p.ratio,
              resolution: "720p",
              generateAudio: true,
            },
            {
              projectId: p.id,
              requestId: r.id,
              storyVersion: p.storyVersion,
              idempotencyKey: `comic:${p.id}:${r.id}`,
            },
          );
        }
        r.status = "RUNNING";
      } catch (e) {
        r.status =
          e instanceof DreaminaPreflightError
            ? "QUOTED"
            : e instanceof DreaminaRejectedError
              ? "FAILED"
              : "UNCERTAIN";
        r.error = message(e);
      }
      delete p.error;
      await this.save(p);
      return p;
    });
  }
  async sync(id: string) {
    return this.exclusive(id, async (p) => {
      const pending = p.runs.filter((r) =>
        ["RUNNING", "SUBMITTING", "UNCERTAIN"].includes(r.status),
      );
      const syncOne = async (r: ShotRun) => {
        try {
          const filename = `${r.id}.${r.kind === "REFERENCE" ? "jpg" : "mp4"}`;
          const target = path.join(this.directory(id), filename);
          if (r.provider === "dreamina") {
            const result = await this.requireDreamina().status(p.canvas!.projectId, r.submitId!);
            const success = result.resources.filter((a) =>
              ["succeeded", "success", "completed"].includes(a.state.toLowerCase()),
            );
            if (success.length > 1) throw new Error("即梦返回多个候选，请先在画布选片");
            if (!success.length) {
              if (
                ["failed", "cancelled"].includes(result.state.toLowerCase()) ||
                result.submissionError
              ) {
                r.status = "FAILED";
                r.error = result.submissionError?.message ?? result.state;
              }
              return;
            }
            r.resourceId = success[0]!.resourceId;
            const receipt = await this.requireDreamina().download(
              p.canvas!.projectId,
              r.resourceId,
              r.kind === "REFERENCE" ? `${target}.original` : target,
            );
            if (!receipt.size) throw new Error("即梦返回空视频");
          } else {
            if (!r.generationId && this.config.video) {
              const recovered = await this.config.video.lookup(`comic:${p.id}:${r.id}`);
              if (recovered) {
                r.generationId = recovered;
              }
            }
            if (!r.generationId) {
              r.error = "提交结果不确定，需核对网关任务，不能自动重复扣费";
              return;
            }
            const result = await this.config.video!.status(r.generationId);
            if (result.status === "FAILED" || result.status === "CANCELLED") {
              r.status = "FAILED";
              r.error = result.error ?? result.status;
              return;
            }
            if (result.status !== "SUCCEEDED" || !result.asset) return;
            if (!result.asset.temporaryUri.startsWith("https://"))
              throw new Error("视频地址必须使用HTTPS");
            const response = await fetch(result.asset.temporaryUri, {
              signal: AbortSignal.timeout(180_000),
            });
            if (!response.ok || !response.body) throw new Error("视频下载失败");
            await pipeline(
              Readable.fromWeb(response.body as never),
              createWriteStream(`${target}.part`),
            );
            await rename(`${target}.part`, target);
          }
          if (r.kind === "REFERENCE") {
            await this.config.media.normalizeReference(`${target}.original`, target);
            const probe = await this.config.media.probe(target);
            if (
              !probe.streams?.some(
                (s) =>
                  s.codec_type === "video" && Number(s.width) >= 256 && Number(s.height) >= 256,
              ) ||
              (await stat(target)).size > 500_000
            )
              throw new Error("角色参考图未通过技术检查");
            r.file = filename;
            r.sha256 = await checksum(target);
            r.basicReview = { sha256: r.sha256, checkedAt: new Date().toISOString(),
              technical: { valid: true, issues: [] }, scope: 'TECHNICAL_ONLY' };
            r.status = "REVIEW";
            delete r.error;
            return;
          }
          const qa = await this.config.media.validateTechnical(target, {
            requireVideo: true,
            requireAudio: true,
            expectedAspectRatio: ratioNumber(p.ratio),
            expectedDurationSeconds: this.shot(p, r.shotId).shot.durationSeconds,
            durationToleranceSeconds: 1.5,
          });
          if (!qa.valid) {
            r.status = "FAILED";
            r.error = qa.issues.map((i) => i.message).join("; ");
            return;
          }
          r.file = filename;
          r.sha256 = await checksum(target);
          const signals = await this.config.media.analyzeSignals(target).catch(() => undefined);
          r.basicReview = { sha256: r.sha256, checkedAt: new Date().toISOString(), technical: qa, ...(signals ? { signals } : {}), scope: 'TECHNICAL_ONLY' };
          if (qa.durationSeconds !== undefined) r.durationSeconds = qa.durationSeconds;
          r.status = "REVIEW";
          delete r.error;
        } catch (e) {
          r.error = message(e);
        }
      };
      // Remote status/downloads are independent; persist only after each bounded batch settles.
      for (let i = 0; i < pending.length; i += 3) {
        await Promise.all(pending.slice(i, i + 3).map(syncOne));
        for (const run of pending.slice(i, i + 3)) {
          if (['REVIEW', 'FAILED'].includes(run.status)) run.completedAt ??= new Date().toISOString();
        }
        await this.save(p);
      }
      delete p.error;
      await this.save(p);
      return p;
    });
  }
  async approve(id: string, runId: string, expectedSha?: string) {
    return this.exclusive(id, async (p) => {
      const r = p.runs.find((r) => r.id === runId);
      if (
        !r ||
        !r.file ||
        !["REVIEW", "APPROVED"].includes(r.status) ||
        r.inputHash !== this.hash(p, r.shotId)
      )
        throw new Error("该镜头未通过技术检查或已经过期");
      if (!expectedSha || expectedSha !== r.sha256)
        throw new Error('审核版本已变化，请刷新后重新查看');
      if (r.sha256 && await checksum(path.join(this.directory(id), r.file)) !== r.sha256)
        throw new Error('素材内容已变化，不能沿用之前的审核');
      r.status = "APPROVED";
      r.reviewDecision = { decision: 'APPROVED', sha256: expectedSha, inputHash: r.inputHash,
        at: new Date().toISOString(), actor: 'LOCAL_CREATOR', reason: 'Creator adopted this exact revision' };
      if (r.kind === "REFERENCE" && r.shotId.startsWith('character:')) {
        this.assertIdle(p);
        const characterId = r.shotId.slice(10);
        p.references[characterId] = r.file;
        p.referenceNodes ??= {};
        p.referenceNodes[characterId] = { file: r.file, nodeId: r.nodeId! };
      }
      await this.save(p);
      return p;
    });
  }
  async configureHarness(id: string, policy: HarnessPolicy) {
    return this.exclusive(id, async p => {
      p.harnessPolicy = validateHarnessPolicy(policy);
      await this.save(p);
      return p;
    });
  }
  async recordBilling(id: string, receipt: Omit<BillingReceipt, 'recordedAt' | 'source'>) {
    return this.exclusive(id, async p => {
      if (addBillingReceipt(p, receipt)) await this.save(p);
      return p;
    });
  }
  async configureBudgets(id: string, input: { credits: number; auxiliaryReserved: number; cny: number }) {
    return this.exclusive(id, async p => {
      for (const value of [input?.credits, input?.auxiliaryReserved, input?.cny])
        if (!Number.isFinite(value) || value < 0 || value > 1e9 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-5)
          throw new Error('预算必须为非负金额，最多两位小数');
      if (!Number.isInteger(input.credits) || !Number.isInteger(input.auxiliaryReserved)) throw new Error('积分预算必须为整数');
      p.creditBudget = { ceiling: input.credits, auxiliaryReserved: input.auxiliaryReserved };
      p.currencyBudget = { ceiling: input.cny };
      await this.save(p);
      return p;
    });
  }
  async rejectReview(id: string, runId: string, sha: string, reason: string) {
    return this.exclusive(id, async p => {
      const r = p.runs.find(run => run.id === runId);
      if (!r || r.status !== 'REVIEW' || !sha || r.sha256 !== sha || r.inputHash !== this.hash(p, r.shotId))
        throw new Error('待审版本已变化，请刷新');
      if (!reason.trim() || reason.length > 2000) throw new Error('请填写具体问题、时间码和期望改善（2000字以内）');
      r.status = 'REJECTED';
      r.reviewDecision = { decision: 'REJECTED', sha256: sha, inputHash: r.inputHash,
        at: new Date().toISOString(), actor: 'LOCAL_CREATOR', reason: reason.trim() };
      r.error = `人工拒收：${reason.trim()}`;
      await this.save(p);
      await cleanupRejected(p, this.directory(id), () => this.save(p));
      return p;
    });
  }
  async cleanupRejectedMedia(id: string) {
    return this.exclusive(id, async p => {
      await cleanupRejected(p, this.directory(id), () => this.save(p));
      return p;
    });
  }
  async reviewedManifest(id: string) {
    return this.exclusive(id, async p => {
      const shots = p.story?.episodes.flatMap(e => e.shots) ?? [];
      if (!shots.length) throw new Error('没有可交付镜头');
      const assets = [];
      for (const shot of shots) {
        const r = [...p.runs].reverse().find(run => run.kind !== 'REFERENCE' && run.shotId === shot.id && run.status === 'APPROVED'
          && run.inputHash === this.hash(p, shot.id) && run.reviewDecision?.decision === 'APPROVED'
          && run.reviewDecision.sha256 === run.sha256 && run.reviewDecision.inputHash === run.inputHash);
        if (!r?.file || !r.sha256) throw new Error(`镜头 ${shot.id} 缺少当前版本的人工采纳`);
        const resolved = await this.asset(id, r.file);
        if (await checksum(resolved.absolute) !== r.sha256) throw new Error(`镜头 ${shot.id} 文件已变化`);
        assets.push({ assetId: shot.id, revision: r.id, sha256: r.sha256, file: r.file,
          inputHash: r.inputHash, durationSeconds: r.durationSeconds ?? shot.durationSeconds,
          characterIds: shot.characterIds, scene: shot.scene, approval: r.reviewDecision });
      }
      return { schemaVersion: 'filmgame-reviewed-media/1', projectId: id, storyVersion: p.storyVersion,
        createdAt: new Date().toISOString(), kind: 'REVIEWED_MEDIA_HANDOFF', assets,
        runtimeIntegrated: false, runtimeVerified: false };
    });
  }
  async acknowledgeReview(id: string, runId: string, sha: string) {
    return this.exclusive(id, async p => {
      const run = p.runs.find(r => r.id === runId);
      if (!run || run.status !== 'REVIEW' || !sha || run.sha256 !== sha || run.inputHash !== this.hash(p, run.shotId))
        throw new Error('待审版本已变化，请刷新');
      run.reviewAcknowledgedSha = sha;
      await this.save(p);
      return p;
    });
  }
  async reference(id: string, characterId: string, data: Buffer, mime: string) {
    return this.exclusive(id, async (p) => {
      this.assertIdle(p);
      if (!p.story?.characters.some((c) => c.id === characterId)) throw new Error("角色不存在");
      if (data.length > 500_000 || !["image/png", "image/jpeg"].includes(mime))
        throw new Error("请上传500KB以内的PNG/JPEG角色参考图");
      if (
        !(mime === "image/png"
          ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : data[0] === 255 && data[1] === 216)
      )
        throw new Error("图片文件格式不正确");
      const filename = `reference-${randomUUID()}.${mime === "image/png" ? "png" : "jpg"}`;
      await writeFile(path.join(this.directory(id), filename), data, { flag: "wx" });
      p.references[characterId] = filename;
      if (p.referenceNodes) delete p.referenceNodes[characterId];
      await this.save(p);
      return p;
    });
  }
  async exportEpisode(id: string, episodeId: string) {
    return this.exclusive(id, async (p) => {
      const ep = p.story?.episodes.find((e) => e.id === episodeId);
      if (!ep) throw new Error("分集不存在");
      const selected = ep.shots.map((s) =>
        [...p.runs]
          .reverse()
          .find(
            (r) =>
              r.kind !== 'REFERENCE' && r.shotId === s.id &&
              r.status === "APPROVED" &&
              r.file &&
              r.inputHash === this.hash(p, s.id),
          ),
      );
      if (selected.some((r) => !r)) throw new Error("请先生成并审核本集全部镜头");
      const exportId = randomUUID();
      const folder = path.join(this.directory(id), `export-${exportId}`);
      await mkdir(folder);
      const dimensions =
        p.ratio === "9:16" ? [720, 1280] : p.ratio === "1:1" ? [720, 720] : [1280, 720];
      const lines: string[] = [];
      const cues: string[] = [];
      let time = 0;
      let cue = 0;
      for (let i = 0; i < selected.length; i++) {
        const r = selected[i]!;
        const clip = `clip-${i}.mp4`;
        const original = path.join(this.directory(id), r.file!);
        if ((await checksum(original)) !== r.sha256) throw new Error("镜头校验值变化，请重新检查");
        await this.config.media.normalizeEpisodeClip({
          inputPath: original,
          outputPath: path.join(folder, clip),
          width: dimensions[0]!,
          height: dimensions[1]!,
        });
        lines.push(`file '${clip}'`);
        for (const d of ep.shots[i]!.dialogue)
          cues.push(
            `${++cue}\n${timestamp(time + d.startSeconds)} --> ${timestamp(time + d.endSeconds)}\n${d.text}\n`,
          );
        const probe = await this.config.media.probe(path.join(folder, clip));
        time += Number(probe.format?.duration ?? r.durationSeconds);
      }
      const list = path.join(folder, "clips.txt");
      await writeFile(list, lines.join("\n"));
      const assembled = path.join(folder, "assembled.mp4");
      await this.config.media.concat({ concatListPath: list, outputPath: assembled });
      const subFile = `episode-${exportId}.srt`;
      const finalFile = `episode-${exportId}.mp4`;
      await writeFile(path.join(this.directory(id), subFile), cues.join("\n"));
      if (cues.length)
        await this.config.media.attachSubtitleTrack({
          inputPath: assembled,
          subtitlePath: path.join(this.directory(id), subFile),
          outputPath: path.join(this.directory(id), finalFile),
        });
      else await copyFile(assembled, path.join(this.directory(id), finalFile));
      const qa = await this.config.media.validateTechnical(
        path.join(this.directory(id), finalFile),
        {
          requireVideo: true,
          requireAudio: true,
          expectedAspectRatio: ratioNumber(p.ratio),
          expectedDurationSeconds: time,
          durationToleranceSeconds: 2,
        },
      );
      if (!qa.valid) throw new Error("整集文件未通过技术检查");
      p.exports.push({
        episodeId,
        file: finalFile,
        subtitles: subFile,
        storyVersion: p.storyVersion,
        runIds: selected.map((r) => r!.id),
        createdAt: new Date().toISOString(),
      });
      p.phase = "整集已导出（字幕按剧本时间轴，需校对）";
      await this.save(p);
      return p;
    });
  }
  requireDreamina() {
    if (!this.config.dreamina) throw new Error("未配置即梦CLI");
    return this.config.dreamina;
  }
  async asset(id: string, filename: string) {
    if (!/^[a-zA-Z0-9_-]+\.(mp4|srt|png|jpg)$/.test(filename)) throw new Error("无效素材路径");
    const p = await this.get(id);
    const allowed = [
      ...Object.values(p.references),
      ...p.runs.map((r) => r.file),
      ...p.exports.flatMap((e) => [e.file, e.subtitles]),
    ];
    if (!allowed.includes(filename)) throw new Error("素材不存在");
    const absolute = path.join(this.directory(id), filename);
    return { absolute, size: (await stat(absolute)).size };
  }
}
export function message(e: unknown) {
  return (e instanceof Error ? e.message : "操作失败")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 1500);
}
function ratioNumber(r: Ratio) {
  const [a, b] = r.split(":").map(Number);
  return a! / b!;
}
export function timestamp(s: number) {
  const ms = Math.round(s * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
async function checksum(file: string) {
  const hash = createHash("sha256");
  for await (const c of createReadStream(file)) hash.update(c);
  return hash.digest("hex");
}
