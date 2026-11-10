import { readFile, writeFile } from 'node:fs/promises';
import { prepareAuthoring, recordAuthoring, renderAuthoring, verifyAuthoringChain } from '../packages/story-engine/src/interactive-authoring.js';

const [command, ...args] = process.argv.slice(2);
const option = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const required = (key: string) => { const value = option(key); if (!value) throw new Error(`Missing ${key}`); return value; };
const json = async (file: string) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
if (!['prepare', 'record', 'verify', 'export'].includes(command ?? '')) throw new Error('Commands: prepare|record|verify|export --context FILE [--chain FILE] [--output FILE]; record also requires --packet FILE --result FILE');
const context = await json(required('--context'));
const chain = option('--chain') ? await json(required('--chain')) : [];
let output: unknown;
if (command === 'prepare') output = prepareAuthoring(context, chain);
else if (command === 'record') output = recordAuthoring(context, chain, await json(required('--packet')), await json(required('--result')));
else if (command === 'export') output = renderAuthoring(context, chain);
else { verifyAuthoringChain(context, chain); console.log(`Valid candidate chain: ${chain.length}/3 stages; semantic review still required`); }
if (output !== undefined) {
  await writeFile(required('--output'), typeof output === 'string' ? output : JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Written without overwriting existing files; no provider invoked');
}
