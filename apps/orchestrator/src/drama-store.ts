import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile, opendir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dramaContent, validateDrama } from '@filmgame/story-engine';

import type { DramaAsset, DramaRecord } from '../../../packages/shared-types/src/drama.js';
export type { DramaAsset, DramaRecord, DramaRender } from '../../../packages/shared-types/src/drama.js';

export class DramaStore {
  readonly records = new Map<string, DramaRecord>();
  private readonly writes = new Map<string, Promise<void>>();
  constructor(readonly root: string) { if (!path.isAbsolute(root)) throw new Error('Drama root must be absolute'); }
  async init(): Promise<void> {
    await mkdir(path.join(this.root, 'projects'), { recursive: true });
    const directory = await opendir(path.join(this.root, 'projects'));
    for await (const entry of directory) {
      if (!/^drama-[a-f0-9-]+\.json$/.test(entry.name)) continue;
      const record = JSON.parse(await readFile(path.join(this.root, 'projects', entry.name), 'utf8')) as DramaRecord;
      if (`${record.id}.json` !== entry.name || typeof record.ownerId !== 'string' || !record.ownerId) throw new Error(`Invalid persisted drama identity: ${entry.name}`);
      for (const doc of [...record.history, ...(record.document ? [record.document] : [])]) {
        if (doc.schemaVersion !== '1.0.0' || doc.projectId !== record.id || !Number.isSafeInteger(doc.version) || doc.version < 1 ||
          doc.parentVersion !== (doc.version === 1 ? null : doc.version - 1)) throw new Error(`Invalid persisted drama version: ${entry.name}`);
        validateDrama(dramaContent(doc));
      }
      if (record.status === 'GENERATING' || record.status === 'REVISING') { record.status = 'FAILED'; record.error = '服务重启中断了生成，可重新提交创作要求'; }
      for (const run of record.renders) if (run.status === 'RUNNING') { run.status = 'FAILED'; run.message = '服务重启中断了制作，可重试；已完成镜头将复用'; }
      this.records.set(record.id, record);
    }
  }
  get(id: string, ownerId: string): DramaRecord {
    const record = this.records.get(id);
    if (!record || record.ownerId !== ownerId) throw new Error('NOT_FOUND');
    return record;
  }
  async save(record: DramaRecord): Promise<void> {
    if (!/^drama-[a-f0-9-]+$/.test(record.id)) throw new Error('Invalid drama ID');
    record.updatedAt = new Date().toISOString();
    const destination = path.join(this.root, 'projects', `${record.id}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const snapshot = JSON.stringify(record);
    const writing = (this.writes.get(record.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, destination);
    });
    this.writes.set(record.id, writing);
    await writing;
    if (this.writes.get(record.id) === writing) this.writes.delete(record.id);
    this.records.set(record.id, record);
  }
  assetPath(id: string): string {
    if (!/^asset-[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_ASSET_ID');
    return path.join(this.root, 'assets', id);
  }
  async put(source: Uint8Array | Readable, mimeType: string, maxBytes = 512 * 1024 * 1024): Promise<DramaAsset> {
    await mkdir(path.join(this.root, 'assets'), { recursive: true });
    const temporary = path.join(this.root, 'assets', `${randomUUID()}.tmp`);
    const hash = createHash('sha256'); let sizeBytes = 0;
    try {
      await pipeline(source instanceof Uint8Array ? Readable.from([source]) : source, new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.length;
          if (sizeBytes > maxBytes) return callback(new Error('素材超过大小限制'));
          hash.update(chunk); callback(null, chunk);
        },
      }), createWriteStream(temporary));
      const sha256 = hash.digest('hex'); const id = `asset-${sha256}`;
      await rename(temporary, this.assetPath(id));
      return { id, sha256, mimeType, sizeBytes };
    } finally { await rm(temporary, { force: true }); }
  }
  async importGenerated(uri: string, mimeType: string, signal: AbortSignal): Promise<DramaAsset> {
    if (uri.startsWith('file:')) return this.put(createReadStream(fileURLToPath(uri)), mimeType);
    const response = await fetch(uri, { signal });
    if (!response.ok || !response.body) throw new Error(`读取生成素材失败 HTTP ${response.status}`);
    return this.put(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), mimeType);
  }
  async dataUri(record: DramaRecord, id: string): Promise<string> {
    const asset = record.assets[id];
    if (!asset) throw new Error('素材不属于当前项目');
    if (asset.sizeBytes > 20 * 1024 * 1024) throw new Error('参考素材不能超过 20 MB');
    return `data:${asset.mimeType};base64,${(await readFile(this.assetPath(id))).toString('base64')}`;
  }
  async assetExists(record: DramaRecord, id: string): Promise<boolean> {
    if (!record.assets[id]) return false;
    try { return (await stat(this.assetPath(id))).size === record.assets[id]!.sizeBytes; } catch { return false; }
  }
}

export function publicDrama(record: DramaRecord) {
  const { ownerId: _owner, history, ...rest } = record;
  return { ...rest, versions: history.map((doc) => ({ version: doc.version, title: doc.title })) };
}
