import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ComicProject } from './comic-service.js';

export async function cleanupRejected(project: ComicProject, directory: string, save: () => Promise<void>) {
  for (const run of project.runs) {
    if (run.status !== 'REJECTED' || !run.file || !run.sha256) continue;
    const name = run.file;
    if (!/^[a-zA-Z0-9_-]+\.(mp4|jpg|png)$/.test(name)) continue;
    const referenced = Object.values(project.references).includes(name)
      || Object.values(project.referenceNodes ?? {}).some(ref => ref.file === name)
      || Object.values(project.shotReferences ?? {}).some(refs => refs.some(ref => ref.file === name))
      || project.runs.some(other => other.id !== run.id && (other.file === name || other.referenceUploads?.some(ref => ref.file === name)))
      || project.exports.some(e => e.runIds.includes(run.id) || e.file === name);
    if (referenced) { run.cleanup = { status: 'RETAINED_DEPENDENCY', file: name, sha256: run.sha256 }; continue; }
    const root = await realpath(directory);
    const candidate = path.resolve(root, name);
    if (path.dirname(candidate) !== root) throw new Error('Cleanup path escaped project');
    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink() || await realpath(candidate) !== candidate)
        throw new Error('Cleanup refuses non-regular or redirected media');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(candidate)) hash.update(chunk);
      if (hash.digest('hex') !== run.sha256) throw new Error('Rejected media changed; cleanup requires recheck');
      run.cleanup = { status: 'DELETE_PLANNED', file: name, sha256: run.sha256 };
      await save();
      await unlink(candidate);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || run.cleanup?.status !== 'DELETE_PLANNED') throw cause;
    }
    run.cleanup = { status: 'DELETED', file: name, sha256: run.sha256, at: new Date().toISOString() };
    delete run.file;
    await save();
  }
  await save();
}

export type CleanupReceipt = {
  status: 'DELETE_PLANNED' | 'DELETED' | 'RETAINED_DEPENDENCY';
  file: string;
  sha256: string;
  at?: string;
};
