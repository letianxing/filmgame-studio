import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, opendir, readFile, writeFile, link, rm } from 'node:fs/promises';
import { validateScreenplay, reviseScreenplay, type ScreenplayDocument, type ScreenplayRevisionOptions } from '../../../packages/story-engine/src/screenplay.js';

/** Immutable local authoring snapshots; atomic no-replace publication also protects concurrent CLI writers. */
export class FileScreenplayStore {
  constructor(readonly root: string) { if (!path.isAbsolute(root)) throw new Error('Screenplay store root must be absolute'); }
  private directory(id: string): string {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(id)) throw new Error('Invalid project ID');
    return path.join(this.root, id);
  }
  async latest(id: string): Promise<ScreenplayDocument | null> {
    const directory = this.directory(id); let latest = 0;
    try {
      for await (const entry of await opendir(directory)) {
        const match = /^v([1-9]\d*)\.json$/.exec(entry.name);
        if (entry.isFile() && match) latest = Math.max(latest, Number(match[1]));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    return latest ? this.get(id, latest) : null;
  }
  async get(id: string, version: number): Promise<ScreenplayDocument> {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid version');
    const document = JSON.parse(await readFile(path.join(this.directory(id), `v${version}.json`), 'utf8')) as ScreenplayDocument;
    if (document.schemaVersion !== '1.0.0' || document.projectId !== id || document.version !== version ||
      document.parentVersion !== (version === 1 ? null : version - 1) || !Number.isFinite(Date.parse(document.createdAt))) throw new Error('Invalid stored screenplay envelope');
    validateScreenplay(document.content); return document;
  }
  async commit(id: string, content: unknown, options: ScreenplayRevisionOptions): Promise<ScreenplayDocument> {
    const directory = this.directory(id); validateScreenplay(content);
    if (!options.reason.trim()) throw new Error('A change reason is required');
    const current = await this.latest(id);
    if (options.expectedVersion !== (current?.version ?? 0)) throw new Error('VERSION_CONFLICT');
    if (!current && options.scope === 'dialogue') throw new Error('Dialogue revision requires an existing project');
    const next: ScreenplayDocument = current ? reviseScreenplay(current, content, options) : {
      schemaVersion: '1.0.0', projectId: id, version: 1, parentVersion: null, createdAt: new Date().toISOString(),
      changeReason: options.reason, content: structuredClone(content),
    };
    await mkdir(directory, { recursive: true });
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await link(temp, path.join(directory, `v${next.version}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('VERSION_CONFLICT'); throw error;
    } finally { await rm(temp, { force: true }); }
    return next;
  }
}
