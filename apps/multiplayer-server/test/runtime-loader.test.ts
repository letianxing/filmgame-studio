import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DirectoryRuntimeLoader } from '../src/runtime.js';

test('directory runtime loader resolves one exact project version without scanning', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-runtime-definitions-'));
  try {
    const story = JSON.parse(
      await readFile(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
    ) as { projectId: string };
    const directory = path.join(root, story.projectId, 'runtime-v1');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'story.json'), JSON.stringify(story));
    const runtime = await new DirectoryRuntimeLoader(root).load(story.projectId, 1);
    assert.equal(runtime.story.projectId, story.projectId);
    assert.equal(runtime.initialState.phase, 'LOBBY');
    await assert.rejects(
      new DirectoryRuntimeLoader(root).load('../escape', 1),
      /Invalid runtime project id/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
