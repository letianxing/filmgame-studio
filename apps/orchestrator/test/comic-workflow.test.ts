import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ComicService } from '../src/comic-service.js';
import { validateComic, type ComicStory } from '../../../packages/comic-engine/src/index.js';
import { DreaminaAdapter, DreaminaPreflightError, dreaminaNodeId } from '../../../services/dreamina-adapter/src/index.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';
import { RemoteVideoProvider } from '../../../services/remote-video-adapter/src/index.js';

const story: ComicStory = { title: 'Test story', logline: 'A letter arrives.', visualStyle: 'ink animation', characters: [{ id: 'hero', name: 'Hero', appearance: 'red coat', voice: 'calm' }], episodes: [{ id: 'ep1', title: 'Arrival', synopsis: 'The hero opens a letter.', shots: [{ id: 's1', scene: 'Room', description: 'Open letter', camera: 'Close up', durationSeconds: 4, characterIds: ['hero'], dialogue: [{ characterId: 'hero', text: 'Who sent this?', startSeconds: 1, endSeconds: 3 }] }, { id: 's2', scene: 'Window', description: 'Looks out', camera: 'Wide', durationSeconds: 4, characterIds: [], dialogue: [] }] }] };
async function setup(video: RemoteVideoProvider | null = null, dreamina: DreaminaAdapter | null = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filmgame-comic-test-'));
  const service = new ComicService({ root, video, dreamina, llm: null, media: new MediaPipeline({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }) });
  let project = await service.create({ idea: 'A young hero discovers an old letter.', style: 'ink', episodeCount: 1, episodeSeconds: 15, ratio: '9:16' });
  project = await service.apply(project.id, structuredClone(story), project.revision);
  project = await service.configureBudgets(project.id, { credits: 100, auxiliaryReserved: 0, cny: 10 });
  return { service, project };
}
test('comic domain rejects unknown roles, duplicate IDs and overlapping dialogue', () => {
  assert.doesNotThrow(() => validateComic(story));
  let bad = structuredClone(story); bad.episodes[0]!.shots[0]!.characterIds = ['unknown']; assert.throws(() => validateComic(bad));
  bad = structuredClone(story); bad.episodes[0]!.shots[1]!.id = 's1'; assert.throws(() => validateComic(bad));
  bad = structuredClone(story); bad.episodes[0]!.shots[0]!.dialogue.push({ characterId: 'hero', text: 'Overlap', startSeconds: 2, endSeconds: 4 }); assert.throws(() => validateComic(bad));
});
test('story revisions are immutable; changes invalidate only affected shots and exports', async () => {
  const { service, project } = await setup();
  const before = ['s1','s2'].map(s => service.hash(project,s));
  const edited = structuredClone(story); edited.characters[0]!.appearance = 'blue coat';
  await assert.rejects(service.apply(project.id, edited, 0), /版本/);
  const next = await service.apply(project.id, edited, project.revision);
  assert.notEqual(service.hash(next,'s1'), before[0]); assert.equal(service.hash(next,'s2'),before[1]);
  assert.deepEqual(JSON.parse(await readFile(path.join(service.directory(project.id),'versions','1.json'),'utf8')),story);
  const restored = await service.apply(project.id, story, next.revision); assert.equal(restored.storyVersion,3); assert.equal(service.hash(restored,'s1'), before[0]);
  const output = { episodeId: 'ep1', file: 'episode.mp4', subtitles: 'episode.srt', storyVersion: 3, runIds: ['r1','r2'], createdAt: '' };
  restored.runs = ['s1','s2'].map((shotId,i) => ({ id:`r${i+1}`, shotId, provider:'seedance', status:'APPROVED', inputHash:service.hash(restored,shotId), storyVersion:3, createdAt:'' }));
  assert.equal(service.exportIsCurrent(restored,output),true);
  restored.references.hero = 'changed.png'; assert.equal(service.exportIsCurrent(restored,output),false);
});
test('ambiguous submission survives restart and cannot be resubmitted or edited', async () => {
  let submits = 0;
  const video = { submit: async () => { submits++; throw new Error('network interrupted'); }, lookup:async () => null } as unknown as RemoteVideoProvider;
  const { service, project } = await setup(video);
  const prepared = await service.prepare(project.id,'s1','seedance');
  const run = prepared.runs[0]!; const submitted = await service.run(project.id,run.id,undefined,{ ceiling: 1, evidence: 'fixture quote' });
  assert.equal(submitted.runs[0]!.status,'UNCERTAIN');
  const restarted = new ComicService(service.config);
  await restarted.sync(project.id);
  await assert.rejects(restarted.run(project.id,run.id));
  await assert.rejects(restarted.prepare(project.id,'s1','seedance'));
  await assert.rejects(restarted.apply(project.id,story,(await restarted.get(project.id)).revision));
  assert.equal(submits,1);
});
test('generated reference approval locks the source node; later appearance changes invalidate it', async () => {
  const { service, project } = await setup();
  const r = {id:'ref1',shotId:'character:hero',kind:'REFERENCE' as const,provider:'dreamina' as const,status:'REVIEW' as const,storyVersion:1,inputHash:service.hash(project,'character:hero'),createdAt:'',file:'ref1.jpg',nodeId:dreaminaNodeId()};
  assert.match(r.nodeId,/^node_[0-9a-hjkmnp-tv-z]{10}$/);
  const bytes = Buffer.from('reference fixture');
  const sha = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(service.directory(project.id), r.file), bytes);
  project.runs.push({...r, sha256: sha});await service.save(project);
  const approved=await service.approve(project.id,r.id,sha);
  assert.equal(approved.references.hero,'ref1.jpg');assert.equal(approved.referenceNodes?.hero?.nodeId,r.nodeId);
  const changed=structuredClone(story);changed.characters[0]!.appearance='new face';
  const next=await service.apply(project.id,changed,approved.revision);assert.notEqual(service.hash(next,r.shotId),r.inputHash);
});
test('credit confirmation failure leaves the task unsubmitted and recoverable', async () => {
  const {service,project}=await setup(null,{run:async()=>{throw new DreaminaPreflightError('approval expired');}} as unknown as DreaminaAdapter);
  project.runs.push({id:'run1',shotId:'s1',provider:'dreamina',status:'QUOTED',storyVersion:1,inputHash:service.hash(project,'s1'),createdAt:'',credits:20,nodeId:dreaminaNodeId(),submitId:'stable'});project.canvas={projectId:'canvas'};await service.save(project);
  const p=await service.run(project.id,'run1',20);assert.equal(p.runs[0]!.status,'QUOTED');
});
test('Jimeng records operation IDs before side effects and requires explicit credit ceiling', async () => {
  let service: ComicService; let projectId = ''; let submitted = 0;
  const cli = {
    auth: async () => ({loggedIn:true}), createCanvas: async (_name: string,id: string) => ({projectId:id,webUrl:'https://example.test/canvas'}),
    saveVideo: async (input: {nodeId:string;updateId:string}) => { const p = await service.get(projectId); assert.equal(p.runs[0]!.nodeId,input.nodeId); assert.equal(p.runs[0]!.updateId,input.updateId); assert.ok(p.runs[0]!.submitId); },
    quote: async (_canvas:string,nodeId:string) => ({totalMaxCredits:20,confirmable:true,items:[{nodeId,maxCredits:20}]}),
    run: async () => { submitted++; },
  } as unknown as DreaminaAdapter;
  const fixture = await setup(null,cli); service=fixture.service;projectId=fixture.project.id;
  const p = await service.prepare(projectId,'s1','dreamina');
  await assert.rejects(service.run(projectId,p.runs[0]!.id)); await assert.rejects(service.run(projectId,p.runs[0]!.id,19)); assert.equal(submitted,0);
  await service.run(projectId,p.runs[0]!.id,20); await assert.rejects(service.run(projectId,p.runs[0]!.id,20)); assert.equal(submitted,1);
});
test('a passed video requires human approval and a matching current dependency hash', async () => {
  const { service, project } = await setup();
  await assert.rejects(service.exportEpisode(project.id,'ep1'));
  const p = await service.prepare(project.id,'s1','seedance'); const run=p.runs[0]!;
  await assert.rejects(service.approve(p.id,run.id));
  run.status='REVIEW'; run.file='clip.mp4';
  const bytes = Buffer.from('video fixture'); run.sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(service.directory(p.id),run.file),bytes); await service.save(p);
  await assert.rejects(service.approve(p.id,run.id,'old-sha'),/版本/);
  const approved=await service.approve(p.id,run.id,run.sha256); assert.equal(approved.runs[0]!.status,'APPROVED');
  const changed=structuredClone(story);changed.episodes[0]!.shots[0]!.description='Different action';
  await service.apply(p.id,changed,approved.revision); await assert.rejects(service.approve(p.id,run.id));
});

test('reviewed handoff requires every current human decision and rejects changed bytes', async () => {
  const { service, project } = await setup();
  for (const shotId of ['s1', 's2']) {
    const file = `${shotId}.mp4`;
    const bytes = Buffer.from(`fixture ${shotId}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(service.directory(project.id), file), bytes);
    project.runs.push({ id: shotId, shotId, provider: 'seedance', status: 'REVIEW', file, sha256,
      inputHash: service.hash(project, shotId), storyVersion: 1, createdAt: new Date().toISOString() });
  }
  await service.save(project);
  await assert.rejects(service.reviewedManifest(project.id), /人工采纳/);
  const first = project.runs[0]!;
  const second = project.runs[1]!;
  await service.approve(project.id, first.id, first.sha256);
  await assert.rejects(service.reviewedManifest(project.id), /s2/);
  await service.rejectReview(project.id, second.id, second.sha256!, '00:02 hand contact wrong');
  const restarted = new ComicService(service.config);
  assert.equal((await restarted.get(project.id)).runs[1]!.reviewDecision?.reason, '00:02 hand contact wrong');
  await assert.rejects(restarted.approve(project.id, second.id, second.sha256));
  // A revised candidate must receive a new review; rejection itself cannot promote it.
  const p = await restarted.get(project.id);
  await writeFile(path.join(service.directory(project.id), second.file!), Buffer.from('fixture s2'));
  p.runs.push({ ...second, id: 's2-revision', status: 'REVIEW' });
  await restarted.save(p);
  await restarted.approve(project.id, 's2-revision', second.sha256);
  const manifest = await restarted.reviewedManifest(project.id);
  assert.equal(manifest.assets.length, 2);
  assert.equal(manifest.runtimeVerified, false);
  await writeFile(path.join(service.directory(project.id), first.file!), 'replaced');
  await assert.rejects(restarted.reviewedManifest(project.id), /文件已变化/);
});

test('CNY submission requires priced consent and reserves before remote side effects', async () => {
  let submits = 0;
  let service: ComicService;
  let projectId = '';
  const video = { submit: async () => {
    submits++;
    const persisted = await service.get(projectId);
    assert.equal(persisted.runs[0]!.status, 'SUBMITTING');
    assert.equal(persisted.runs[0]!.currencyCeiling, 2);
    throw new Error('ambiguous response');
  } } as unknown as RemoteVideoProvider;
  const fixture = await setup(video); service = fixture.service; projectId = fixture.project.id;
  const p = await service.prepare(projectId, 's1', 'seedance');
  const runId = p.runs[0]!.id;
  await assert.rejects(service.run(projectId, runId), /人民币/);
  await assert.rejects(service.run(projectId, runId, undefined, { ceiling: 11, evidence: 'quote' }), /额度不足/);
  await assert.rejects(service.run(projectId, runId, undefined, { ceiling: 2, evidence: '' }), /报价依据/);
  assert.equal(submits, 0);
  await service.run(projectId, runId, undefined, { ceiling: 2, evidence: 'checked quote' });
  assert.equal(submits, 1);
  await assert.rejects(service.run(projectId, runId, undefined, { ceiling: 2, evidence: 'checked quote' }));
  assert.equal(submits, 1);
});

test('scene and voice changes invalidate only shots using those references', async () => {
  const {service,project}=await setup();
  const before=['s1','s2'].map(id=>service.hash(project,id));
  project.shotReferences={s1:[{nodeId:dreaminaNodeId(),file:'room.png',mediaType:'image',role:'场景'}]};
  assert.notEqual(service.hash(project,'s1'),before[0]);
  assert.equal(service.hash(project,'s2'),before[1]);
});

test('project credit cap includes uncertain submissions and auxiliary assets', async () => {
  let submissions=0;
  const {service,project}=await setup(null,{run:async()=>{submissions++;}} as unknown as DreaminaAdapter);
  project.creditBudget={ceiling:100,auxiliaryReserved:15};project.canvas={projectId:'canvas'};
  project.runs.push({id:'existing',shotId:'s2',provider:'dreamina',status:'UNCERTAIN',storyVersion:1,inputHash:service.hash(project,'s2'),createdAt:'',creditCeiling:70});
  project.runs.push({id:'new',shotId:'s1',provider:'dreamina',status:'QUOTED',storyVersion:1,inputHash:service.hash(project,'s1'),createdAt:'',credits:20,nodeId:dreaminaNodeId(),submitId:'stable'});
  await service.save(project);
  await assert.rejects(service.run(project.id,'new',20),/额度不足/);
  assert.equal(submissions,0);
});
