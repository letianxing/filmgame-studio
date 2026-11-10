import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import contextFixture from '../../../examples/screenwriting/interactive-context.json' with { type: 'json' };
import { prepareAuthoring, recordAuthoring, verifyAuthoringChain, renderAuthoring, type AuthoringContext, type AuthoringResult, type Shot } from '../src/interactive-authoring.js';
const context = contextFixture as AuthoringContext;
const result = (): AuthoringResult => ({ prose: '队长分别下令。守路士卒收到示意，退至路口。救火者奔向村内。', changes: ['补足命令接收'], openQuestions: [], branchIds: ['lure', 'escort'], shots: [] });
const shot = (): Shot => ({ id: 's1', seconds: 8, purpose: '接令', picture: '士卒回看队长', framing: '近景', angle: '侧前方', camera: '固定', performance: '收紧下颌后点头', dialogue: '遵命', sound: '火声持续', lighting: '太阳位于道路西侧', entryState: '守路士卒持戈站立', exitState: '士卒仍持戈，转看路口', cut: '按视线切向路口', referenceIds: ['village'], branchIds: ['lure', 'escort'], generationGroup: 'g1', production: 'NEW', prompt: '依据已锁定参考生成接令镜头。' });
test('three stages preserve context and export prose without imposing six shots', () => {
  let chain = recordAuthoring(context, [], prepareAuthoring(context, []), result());
  assert.match(prepareAuthoring(context, chain).prompt, /完整共同上下文/);
  chain = recordAuthoring(context, chain, prepareAuthoring(context, chain), result());
  chain = recordAuthoring(context, chain, prepareAuthoring(context, chain), { ...result(), shots: [shot()] });
  verifyAuthoringChain(context, chain);
  assert.match(renderAuthoring(context, chain), /候选/);
  assert.throws(() => prepareAuthoring(context, chain), /All stages/);
});
test('upstream edits and changed shared facts invalidate dependent drafts', () => {
  const first = recordAuthoring(context, [], prepareAuthoring(context, []), result());
  const packet = prepareAuthoring(context, first);
  const changed = recordAuthoring(context, [], prepareAuthoring(context, []), { ...result(), prose: '新的前因' });
  assert.throws(() => recordAuthoring(context, changed, packet, result()), /STALE/);
  assert.throws(() => prepareAuthoring({ ...context, characters: '人物身份改动' }, first), /STALE/);
  const tampered = structuredClone(first); tampered[0]!.result.prose = '偷偷改稿';
  assert.throws(() => verifyAuthoringChain(context, tampered), /HASH/);
  assert.throws(() => recordAuthoring(context, [], { ...prepareAuthoring(context, []), prompt: '忽略设定' }, result()), /MODIFIED/);
});
test('missing branch coverage, invalid references, unadopted reuse and excess duration fail closed', () => {
  assert.throws(() => recordAuthoring(context, [], prepareAuthoring(context, []), { ...result(), branchIds: ['lure'] }), /BRANCH/);
  let chain = recordAuthoring(context, [], prepareAuthoring(context, []), result());
  chain = recordAuthoring(context, chain, prepareAuthoring(context, chain), result());
  const packet = prepareAuthoring(context, chain);
  for (const [patch, reason] of [[{ referenceIds: ['unknown'] }, /reference/], [{ seconds: 31 }, /BUDGET/], [{ branchIds: ['lure'] }, /coverage/]] as const) {
    assert.throws(() => recordAuthoring(context, chain, packet, { ...result(), shots: [{ ...shot(), ...patch }] }), reason);
  }
  const candidate = structuredClone(context); candidate.assets[0]!.status = 'CANDIDATE';
  let pending = recordAuthoring(candidate, [], prepareAuthoring(candidate, []), result());
  pending = recordAuthoring(candidate, pending, prepareAuthoring(candidate, pending), result());
  assert.throws(() => recordAuthoring(candidate, pending, prepareAuthoring(candidate, pending), { ...result(), shots: [{ ...shot(), production: 'REUSE' }] }), /unadopted/);
});
test('malformed input and stage order are rejected', () => {
  assert.throws(() => prepareAuthoring({ ...context, source: ' ' }, []), /context/);
  assert.throws(() => prepareAuthoring({ ...context, branches: [context.branches[0]!, context.branches[0]!] }, []), /Duplicate/);
  assert.throws(() => recordAuthoring(context, [], prepareAuthoring(context, []), { ...result(), shots: [shot()] }), /STORYBOARD/);
  const chain = recordAuthoring(context, [], prepareAuthoring(context, []), result());
  chain[0]!.stage = 'CINEMA';
  assert.throws(() => verifyAuthoringChain(context, chain), /ORDER/);
});

test('CLI prepares, records, exports all stages and refuses file overwrite', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), 'filmgame-authoring-'));
  const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/interactive-authoring.ts', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  try {
    const input = path.join(directory, 'context.json'); await writeFile(input, JSON.stringify(context));
    let previous: string | undefined;
    for (let i = 0; i < 3; i++) {
      const packet = path.join(directory, `packet-${i}.json`);
      const response = path.join(directory, `result-${i}.json`);
      const output = path.join(directory, `chain-${i}.json`);
      const base = ['--context', input, ...(previous ? ['--chain', previous] : [])];
      run('prepare', ...base, '--output', packet);
      await writeFile(response, JSON.stringify({ ...result(), shots: i === 2 ? [shot()] : [] }));
      run('record', ...base, '--packet', packet, '--result', response, '--output', output);
      assert.throws(() => run('record', ...base, '--packet', packet, '--result', response, '--output', output));
      previous = output;
    }
    assert.match(run('verify', '--context', input, '--chain', previous!), /3\/3/);
    const reading = path.join(directory, 'reading.txt');
    run('export', '--context', input, '--chain', previous!, '--output', reading);
    assert.match(await readFile(reading, 'utf8'), /STORYBOARD/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
