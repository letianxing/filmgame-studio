import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileScreenplayStore } from '../apps/orchestrator/src/screenplay-store.js';
import { validateScreenplay, renderScreenplay } from '../packages/story-engine/src/screenplay.js';

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const required = (name: string) => { const value = option(name); if (!value) throw new Error(`Missing ${name}`); return value; };
const store = new FileScreenplayStore(path.resolve(option('--root') ?? process.env.SCREENPLAY_STORAGE_ROOT ?? '.local/screenplays'));
if (command === 'validate') {
  if (!args[0]) throw new Error('Usage: screenplay validate <content.json>');
  validateScreenplay(JSON.parse(await readFile(args[0], 'utf8'))); console.log('Screenplay schema and references valid');
} else if (command === 'commit') {
  const expectedVersion = Number(required('--expected-version'));
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('Invalid expected version');
  const scope = option('--scope') ?? 'full';
  if (scope !== 'full' && scope !== 'dialogue') throw new Error('Invalid scope');
  const doc = await store.commit(required('--project'), JSON.parse(await readFile(required('--input'), 'utf8')), {
    expectedVersion, reason: required('--reason'), scope,
    ...(option('--scenes') ? { sceneIds: required('--scenes').split(',') } : {}),
    allowLockedChanges: args.includes('--allow-locked-changes'),
  });
  console.log(JSON.stringify({ projectId: doc.projectId, version: doc.version, parentVersion: doc.parentVersion }));
} else if (command === 'export') {
  const doc = option('--version') ? await store.get(required('--project'), Number(required('--version'))) : await store.latest(required('--project'));
  if (!doc) throw new Error('Project not found');
  await writeFile(required('--output'), renderScreenplay(doc), { flag: 'wx' });
  console.log(`Exported version ${doc.version}`);
} else throw new Error('Commands: validate <content.json>; commit --project ID --input FILE --expected-version N --reason TEXT [--scope dialogue --scenes ID]; export --project ID --output FILE');
