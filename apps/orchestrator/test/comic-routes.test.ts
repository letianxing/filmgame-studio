import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComicService } from '../src/comic-service.js';
import { comicRoute } from '../src/comic-routes.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';

test('HTTP controls persist budgets, expose progress and reject stale approvals without providers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-http-'));
  const service = new ComicService({ root, llm: null, video: null, dreamina: null,
    media: new MediaPipeline({ ffmpegPath: 'unused', ffprobePath: 'unused' }) });
  const server = createServer((req, res) => {
    void comicRoute(service, req, res, new URL(req.url!, 'http://localhost')).then(handled => {
      if (!handled) { res.writeHead(404); res.end(); }
    }).catch(e => { res.writeHead(500); res.end(String(e)); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/v1/comic/projects`;
  const post = (url: string, body: unknown, origin?: string) => fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  try {
    const created = await post(base, { idea: 'A mysterious letter reaches the village.', style: 'ink', ratio: '16:9', episodeCount: 1, episodeSeconds: 20 });
    assert.equal(created.status, 201);
    const initial = await created.json() as { project: { id: string } };
    const url = `${base}/${initial.project.id}`;
    assert.equal((await post(`${url}/budgets`, { credits: 40, auxiliaryReserved: 5, cny: 8.5 })).status, 200);
    const response = await fetch(url);
    const view = await response.json() as { project: { harness: { budget: { ceiling: number; cnyCeiling: number }; review: unknown[] } } };
    assert.equal(view.project.harness.budget.ceiling, 40);
    assert.equal(view.project.harness.budget.cnyCeiling, 8.5);
    assert.deepEqual(view.project.harness.review, []);
    assert.equal((await post(`${url}/budgets`, { credits: 999, auxiliaryReserved: 0, cny: 999 }, 'http://wrong-origin')).status, 403);
    assert.equal((await service.get(initial.project.id)).creditBudget?.ceiling, 40);
    assert.equal((await post(`${url}/approve`, { runId: 'missing', sha256: 'old' })).status, 400);
    assert.equal((await fetch(`${url}/reviewed-manifest`)).status, 400);
    assert.equal((await post(`${url}/harness-policy`, { policy: { maxAttemptsPerShot: 5, maxElapsedMinutesPerShot: 120, providerWaitMinutes: 30 } })).status, 200);
    assert.equal((await new ComicService(service.config).get(initial.project.id)).harnessPolicy?.maxAttemptsPerShot, 5);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('filmgame-http-'));
    await rm(root, { recursive: true, force: true });
  }
});
