import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { cleanupRejected } from '../src/comic-cleanup.js';
import type { ComicProject } from '../src/comic-service.js';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'filmgame-cleanup-'));
  const bytes = Buffer.from('rejected candidate');
  await writeFile(path.join(directory, 'candidate.mp4'), bytes);
  const project: ComicProject = { id: 'p', title: '', idea: '', style: '', ratio: '16:9', episodeCount: 1, episodeSeconds: 20,
    revision: 1, storyVersion: 1, createdAt: '', updatedAt: '', phase: '', references: {}, exports: [],
    runs: [{ id: 'r', shotId: 's', provider: 'dreamina', status: 'REJECTED', file: 'candidate.mp4',
      sha256: createHash('sha256').update(bytes).digest('hex'), storyVersion: 1, inputHash: 'h', createdAt: '' }] };
  return { directory, project };
}

async function removeFixture(directory: string) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('filmgame-cleanup-'));
  await rm(resolved, { recursive: true, force: true });
}

test('rejected media deletion records intent first and keeps SHA after removal', async () => {
  const { directory, project } = await fixture();
  try {
    const states: string[] = [];
    await cleanupRejected(project, directory, async () => { states.push(project.runs[0]!.cleanup!.status); });
    assert.deepEqual(states.slice(0, 2), ['DELETE_PLANNED', 'DELETED']);
    assert.equal(project.runs[0]!.file, undefined);
    assert.equal(project.runs[0]!.sha256?.length, 64);
    await assert.rejects(readFile(path.join(directory, 'candidate.mp4')), { code: 'ENOENT' });
  } finally { await removeFixture(directory); }
});
test('concept references and other candidates protect shared media', async () => {
  const { directory, project } = await fixture();
  try {
    project.references.hero = 'candidate.mp4';
    await cleanupRejected(project, directory, async () => {});
    assert.equal(project.runs[0]!.cleanup?.status, 'RETAINED_DEPENDENCY');
    assert.ok((await readFile(path.join(directory, 'candidate.mp4'))).length);
    delete project.references.hero;
    project.runs.push({ ...project.runs[0]!, id: 'r2', status: 'REVIEW' });
    await cleanupRejected(project, directory, async () => {});
    assert.ok(project.runs[0]!.file);
  } finally { await removeFixture(directory); }
});
test('changed bytes cannot be deleted under old rejected SHA', async () => {
  const { directory, project } = await fixture();
  try {
    await writeFile(path.join(directory, 'candidate.mp4'), 'new content');
    await assert.rejects(cleanupRejected(project, directory, async () => {}), /changed/);
    assert.equal(await readFile(path.join(directory, 'candidate.mp4'), 'utf8'), 'new content');
  } finally { await removeFixture(directory); }
});
