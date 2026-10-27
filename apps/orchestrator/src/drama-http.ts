import type { DramaVideoBackend } from '@filmgame/shared-types';
import { parseVideoBackend, assertWanShots } from './drama-video-routing.js';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LLMProvider } from '@filmgame/provider-sdk';
import { dramaContent, dramaVoiceBlockers, reviseDrama, validateDrama } from '@filmgame/story-engine';
import type { DramaContent } from '@filmgame/shared-types';
import { DramaStore, publicDrama, type DramaRecord, type DramaRender } from './drama-store.js';
import { proposeDrama } from './drama-workflow.js';
import { renderDrama, type DramaRenderServices } from './drama-renderer.js';

export class DramaHttp {
  readonly controllers = new Map<string, AbortController>();
  readonly locks = new Set<string>();
  constructor(readonly store: DramaStore, readonly llm: LLMProvider | null,
    readonly providers: (backend?: DramaVideoBackend) => DramaRenderServices) {}

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/v1/dramas')) return false;
    const owner = request.headers['x-filmgame-owner'];
    if (typeof owner !== 'string' || !owner || owner.length > 200) { send(response, 401, { error: 'UNAUTHENTICATED' }); return true; }
    const match = /^\/v1\/dramas(?:\/(drama-[a-f0-9-]+))?(?:\/assets(?:\/(asset-[a-f0-9]{64}))?)?$/.exec(url.pathname);
    if (!match) { send(response, 404, { error: 'NOT_FOUND' }); return true; }
    const id = match[1]; const assetId = match[2];
    let lock: string | undefined;
    try {
      if (request.method === 'GET' && !id) {
        send(response, 200, { projects: [...this.store.records.values()].filter((r) => r.ownerId === owner)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100).map((r) => ({ id: r.id,
            title: r.document?.title ?? r.idea.slice(0, 30), status: r.status, updatedAt: r.updatedAt })) }); return true;
      }
      if (request.method === 'GET' && id) {
        const record = this.store.get(id, owner);
        if (assetId) { this.streamAsset(record, assetId, request, response, url); return true; }
        send(response, 200, publicDrama(record)); return true;
      }
      if (request.method !== 'POST') { send(response, 405, { error: 'METHOD_NOT_ALLOWED' }); return true; }
      const requestedLock = id ?? `owner:${owner}`;
      if (this.locks.has(requestedLock)) { send(response, 409, { error: '请求处理中，请稍候' }); return true; }
      lock = requestedLock;
      this.locks.add(lock);
      if (id && url.pathname.endsWith('/assets')) {
        const record = this.store.get(id, owner); assertIdle(record);
        const data = await readBody(request, 20 * 1024 * 1024);
        const mime = imageOrWav(data);
        const asset = await this.store.put(data, mime, 20 * 1024 * 1024); record.assets[asset.id] = asset;
        await this.store.save(record); send(response, 201, { asset }); return true;
      }
      const body = JSON.parse((await readBody(request, 1_000_000)).toString('utf8')) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required');
      if (!id) {
        if (!this.llm) throw new Error('请配置 LLM Provider');
        const idea = textField(body.idea);
        if ([...this.store.records.values()].filter((r) => r.ownerId === owner).length >= 200) throw new Error('当前账户项目数达到 200');
        const record: DramaRecord = { id: `drama-${randomUUID()}`, ownerId: owner, idea,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'GENERATING', history: [], assets: {}, renders: [] };
        await this.store.save(record); void this.generate(record, idea);
        send(response, 202, publicDrama(record)); return true;
      }
      const record = this.store.get(id, owner);
      if (body.action === 'cancel') {
        const controller = this.controllers.get(id); if (!controller) throw new Error('没有正在执行的任务');
        controller.abort(); send(response, 202, { status: 'CANCELLING' }); return true;
      }
      assertIdle(record);
      if (body.action === 'propose') {
        if (!this.llm) throw new Error('请配置 LLM Provider');
        const idea = textField(body.text); record.status = record.document ? 'REVISING' : 'GENERATING';
        delete record.error; delete record.proposal; await this.store.save(record); void this.generate(record, idea);
      } else if (body.action === 'save' || body.action === 'apply' || body.action === 'rollback') {
        if (!record.document) throw new Error('剧本尚未生成');
        let content: unknown = body.content;
        if (body.action === 'apply') {
          if (!record.proposal || record.proposal.baseVersion !== record.document.version) throw new Error('VERSION_CONFLICT');
          content = record.proposal.content;
        }
        if (body.action === 'rollback') {
          const previous = record.history.find((d) => d.version === body.targetVersion);
          if (!previous) throw new Error('历史版本不存在'); content = dramaContent(previous);
        }
        validateDrama(content); this.validateBindings(record, content);
        const next = reviseDrama(record.document, content, Number(body.expectedVersion));
        record.history.push(structuredClone(next)); record.document = next; record.status = 'READY';
        delete record.error; delete record.proposal; await this.store.save(record);
      } else if (body.action === 'render') {
        if (!record.document) throw new Error('剧本尚未生成');
        if (body.expectedVersion !== record.document.version) throw new Error('VERSION_CONFLICT');
        const mode = body.mode;
        if (mode !== 'VIDEO' && mode !== 'STORYBOARD') throw new Error('请选择视频或分镜预演');
        const videoBackend = mode === 'VIDEO' ? parseVideoBackend(body.videoBackend) : undefined;
        if (videoBackend === 'WAN') assertWanShots(record.document);
        const total = record.document.episodes.reduce((n, e) => n + e.shots.length, 0);
        if (!Number.isInteger(body.maxShots) || total > Number(body.maxShots) || Number(body.maxShots) > 120) throw new Error('镜头数量超过本次确认的生成上限');
        const blockers = dramaVoiceBlockers(record.document); if (blockers.length) throw new Error(blockers.join('；'));
        this.validateBindings(record, record.document);
        if (this.controllers.size) throw new Error('制作服务正在运行其他任务，请稍候重试');
        const services = this.providers(videoBackend);
        const musicPrompt = body.musicPrompt === undefined || body.musicPrompt === '' ? '' : textField(body.musicPrompt);
        if (musicPrompt.length > 1000) throw new Error('配乐要求请控制在 1000 字内');
        if (musicPrompt && !services.music) throw new Error('请配置 MusicProvider，或清空配乐要求');
        const run: DramaRender = { id: `run-${randomUUID()}`, version: record.document.version, mode, ...(videoBackend ? { videoBackend } : {}), status: 'RUNNING',
          completed: 0, total, message: '等待制作', shots: {}, episodes: [] };
        if (musicPrompt) run.musicPrompt = musicPrompt;
        const controller = new AbortController(); this.controllers.set(id, controller);
        record.renders.push(run);
        try { await this.store.save(record); } catch (error) { this.controllers.delete(id); run.status = 'FAILED'; throw error; }
        void renderDrama(record, run, this.store, services, controller.signal).catch(async (error: unknown) => {
          run.status = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
          run.message = controller.signal.aborted ? '已停止本地制作；已经提交的云端任务可能仍会执行和计费' : safeError(error);
          await this.store.save(record);
        }).finally(() => this.controllers.delete(id));
      } else throw new Error('未知操作');
      send(response, 202, publicDrama(record));
    } catch (error) {
      const message = safeError(error);
      send(response, message === 'NOT_FOUND' ? 404 : /VERSION_CONFLICT|正在|处理中/.test(message) ? 409 : 400, { error: message });
    } finally { if (lock) this.locks.delete(lock); }
    return true;
  }

  private async generate(record: DramaRecord, idea: string): Promise<void> {
    try {
      const content = await proposeDrama(this.llm!, { idea, ...(record.document ? { current: record.document } : {}),
        context: { requestId: randomUUID(), projectId: record.id, storyVersion: record.document?.version ?? 1,
          idempotencyKey: `${record.id}:draft:${randomUUID()}`, signal: AbortSignal.timeout(10 * 60_000) } });
      if (record.document) record.proposal = { baseVersion: record.document.version, content };
      else {
        record.document = { ...content, schemaVersion: '1.0.0', projectId: record.id, version: 1, parentVersion: null };
        record.history.push(structuredClone(record.document));
      }
      record.status = 'READY'; delete record.error;
    } catch (error) { record.status = 'FAILED'; record.error = safeError(error); }
    await this.store.save(record);
  }

  private validateBindings(record: DramaRecord, content: DramaContent): void {
    for (const shot of content.episodes.flatMap((e) => e.shots)) {
      if (shot.firstFrameAssetId && !record.assets[shot.firstFrameAssetId]?.mimeType.startsWith('image/')) throw new Error('镜头首帧不属于当前项目');
    }
    for (const c of content.characters) {
      if (c.referenceImageAssetId && !record.assets[c.referenceImageAssetId]?.mimeType.startsWith('image/')) throw new Error('角色参考图不属于当前项目');
      if (c.voiceReferenceAssetId && record.assets[c.voiceReferenceAssetId]?.mimeType !== 'audio/wav') throw new Error('声音参考必须是当前项目的 WAV');
    }
  }

  private streamAsset(record: DramaRecord, id: string, request: IncomingMessage, response: ServerResponse, url: URL): void {
    const asset = record.assets[id]; if (!asset) throw new Error('NOT_FOUND');
    let start = 0; let end = asset.sizeBytes - 1;
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { response.writeHead(416, { 'content-range': `bytes */${asset.sizeBytes}` }); response.end(); return; }
      if (!match[1] && match[2]) start = Math.max(0, asset.sizeBytes - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
      if ((!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0) { response.writeHead(416, { 'content-range': `bytes */${asset.sizeBytes}` }); response.end(); return; }
    }
    response.writeHead(range ? 206 : 200, { 'content-type': asset.mimeType, 'content-length': end - start + 1,
      'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${asset.sizeBytes}` } : {}),
      ...(url.searchParams.has('download') ? { 'content-disposition': `attachment; filename="${id.slice(0, 20)}.${asset.mimeType === 'video/mp4' ? 'mp4' : asset.mimeType === 'text/vtt' ? 'vtt' : 'bin'}"` } : {}) });
    const stream = createReadStream(this.store.assetPath(id), { start, end });
    stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
  }
}

function assertIdle(record: DramaRecord): void {
  if (record.status === 'GENERATING' || record.status === 'REVISING' || record.renders.some((r) => r.status === 'RUNNING')) throw new Error('任务正在执行，请完成后再修改');
}
async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const data of request) { const chunk = Buffer.from(data); size += chunk.length; if (size > limit) throw new Error('请求内容超过大小限制'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function textField(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 12000) throw new Error('请输入 2–12000 字'); return value.trim();
}
function imageOrWav(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  throw new Error('仅支持 PNG、JPEG 参考图和 WAV 参考音频');
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '操作失败';
  return message.replace(/https?:\/\/[^\s"']+/g, '[provider URL]').slice(0, 1200);
}
function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value));
}
