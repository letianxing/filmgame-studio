import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ComicService} from '../src/comic-service.js';
import {MediaPipeline} from '../../../services/media-pipeline/src/index.js';
import {planLocalRepair,localRepairCapabilities,bindRepairSource} from '../src/comic-local-repair.js';

test('repair video binding verifies source and target without approving defective media', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'filmgame-repair-'));
 const service=new ComicService({root,llm:null,video:null,dreamina:null,media:new MediaPipeline({ffmpegPath:'unused',ffprobePath:'unused'})});
 try {
  let p=await service.create({idea:'Farewell repair.',style:'film',ratio:'16:9',episodeCount:1,episodeSeconds:15});
  p=await service.apply(p.id,{title:'Farewell',logline:'Leave',visualStyle:'film',characters:[{id:'hero',name:'Hero',appearance:'coat',voice:'silent'}],episodes:[{id:'e1',title:'Farewell',synopsis:'Leave',shots:[{id:'s1',scene:'Wall',description:'Farewell',camera:'Push',durationSeconds:7,characterIds:[],dialogue:[]}]}]},p.revision);
  const data=Buffer.from('movie');const sha256=createHash('sha256').update(data).digest('hex');
  await writeFile(path.join(service.directory(p.id),'source.mp4'),data);
  p.runs=[{id:'source',shotId:'s1',provider:'dreamina',status:'REVIEW',storyVersion:1,inputHash:'old',file:'source.mp4',sha256,durationSeconds:7,createdAt:new Date().toISOString()}];await service.save(p);
  const result=await planLocalRepair(service,p.id,{revision:p.revision,runId:'source',sha256,method:'video-shot-regeneration',defect:'identity drift',region:'faces',preserve:['camera','actions'],userDirection:'Correct identity',interval:{startSeconds:0,endSeconds:7},limits:{maxCredits:100,maxMinutes:20,maxAttempts:1}});
  p=result.project;
  const input=()=>({revision:p.revision,planId:result.plan.id,targetInputHash:service.hash(p,'s1')});
  await assert.rejects(bindRepairSource(service,p.id,input()),/image references/);
  p.shotReferences={s1:[{nodeId:'image-node',file:'corrected.png',mediaType:'image',role:'Corrected identity'}]};await service.save(p);
  await assert.rejects(bindRepairSource(service,p.id,{...input(),revision:-1}),/revision/);
  await assert.rejects(bindRepairSource(service,p.id,{...input(),targetInputHash:'stale'}),/Target input/);
  const sourceBefore=JSON.stringify(p.runs);
  p=await bindRepairSource(service,p.id,input());
  assert.equal(p.shotReferences!.s1!.length,2);
  assert.equal(p.shotReferences!.s1![1]!.mediaType,'video');
  assert.match(p.shotReferences!.s1![1]!.role,/NOT_APPROVED/);
  assert.equal(JSON.stringify(p.runs),sourceBefore);
  assert.equal(p.localRepairPlans![0]!.status,'PLANNED_NOT_EXECUTED');
  await assert.rejects(service.reviewedManifest(p.id));
  p=await bindRepairSource(service,p.id,input());assert.equal(p.shotReferences!.s1!.length,2);
  // A partial plan must never silently feed the whole original movie.
  const partial = await planLocalRepair(service,p.id,{revision:p.revision,runId:'source',sha256,method:'video-shot-regeneration',defect:'face',region:'closeup',preserve:['audio'],userDirection:'Repair closeup only',interval:{startSeconds:3,endSeconds:7},limits:{maxCredits:70,maxMinutes:20,maxAttempts:1}});
  p=partial.project;
  const partialInput=()=>({revision:p.revision,planId:partial.plan.id,targetInputHash:service.hash(p,'s1')});
  await assert.rejects(bindRepairSource(service,p.id,partialInput()),/bounded derivative/);
  const clipBytes=Buffer.from('clip'), clipSha=createHash('sha256').update(clipBytes).digest('hex');
  await writeFile(path.join(service.directory(p.id),'clip.mp4'),clipBytes);
  p.runs.push({id:'clip',shotId:'s1',provider:'external',status:'REVIEW',storyVersion:1,inputHash:'old',file:'clip.mp4',sha256:clipSha,durationSeconds:4,createdAt:new Date().toISOString(),derivative:{sourceRunId:'source',sourceSha256:sha256,sourceInterval:{startSeconds:3,endSeconds:7},editDescription:'Trim only',ledger:'receipt.json'}});
  await service.save(p);
  await assert.rejects(bindRepairSource(service,p.id,{...partialInput(),clipRunId:'clip'}),/Target duration/);
  p.story!.episodes[0]!.shots.push({...p.story!.episodes[0]!.shots[0]!,id:'close',durationSeconds:4});
  p.shotReferences!.close=[{nodeId:'image-node',file:'corrected.png',mediaType:'image',role:'Corrected identity'}];await service.save(p);
  const scoped=()=>({revision:p.revision,planId:partial.plan.id,targetInputHash:service.hash(p,'close'),targetShotId:'close',clipRunId:'clip'});
  p=await bindRepairSource(service,p.id,scoped());
  assert.equal(p.shotReferences!.close![1]!.file,'clip.mp4');
  assert.equal(p.runs.find(r=>r.id==='clip')!.status,'REVIEW');
  assert.equal(p.shotReferences!.s1![1]!.file,'source.mp4');
  p.runs.find(r=>r.id==='clip')!.derivative!.sourceInterval!.startSeconds=2;await service.save(p);
  await assert.rejects(bindRepairSource(service,p.id,scoped()),/Exact interval/);
  p.runs.find(r=>r.id==='clip')!.derivative!.sourceInterval!.startSeconds=3;
  await writeFile(path.join(service.directory(p.id),'clip.mp4'),'bad');await service.save(p);
  await assert.rejects(bindRepairSource(service,p.id,scoped()),/Clip path or SHA/);
  await writeFile(path.join(service.directory(p.id),'source.mp4'),'tampered');
  await assert.rejects(bindRepairSource(service,p.id,input()),/SHA/);
  p.runs[0]!.file='../outside.mp4';await service.save(p);
  await assert.rejects(bindRepairSource(service,p.id,input()),/project-local/);
 } finally { assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('filmgame-repair-'));await rm(root,{recursive:true,force:true}); }
});

test('local repair planning preserves adopted media and never grants execution or approval',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'filmgame-repair-'));
 const service=new ComicService({root,llm:null,video:null,dreamina:null,media:new MediaPipeline({ffmpegPath:'unused',ffprobePath:'unused'})});
 try {
  let p=await service.create({idea:'Village local repair.',style:'film',ratio:'16:9',episodeCount:1,episodeSeconds:15});
  const data=Buffer.from('source fixture');const sha256=createHash('sha256').update(data).digest('hex');
  await writeFile(path.join(service.directory(p.id),'source.mp4'),data);
  p.runs=[{id:'source',shotId:'s1',provider:'dreamina',status:'APPROVED',storyVersion:1,inputHash:'original',
    file:'source.mp4',sha256,durationSeconds:12,createdAt:new Date().toISOString()}];
  await service.save(p);
  const input={revision:p.revision,runId:'source',sha256,method:'video-tracked-patch',defect:'extra guard',region:'right background',
    preserve:['original audio','camera cuts'],userDirection:'Remove this guard, retain performance',
    interval:{startSeconds:3,endSeconds:7},limits:{maxCredits:0,maxMinutes:20,maxAttempts:1}};
  await assert.rejects(planLocalRepair(service,p.id,{...input,sha256:'0'.repeat(64)}),/source revision/);
  await assert.rejects(planLocalRepair(service,p.id,{...input,revision:-1}),/revision/);
  await assert.rejects(planLocalRepair(service,p.id,{...input,interval:{startSeconds:3,endSeconds:13}}),/interval/);
  await assert.rejects(planLocalRepair(service,p.id,{...input,limits:{...input.limits,maxCredits:NaN}}),/limits/);
  await assert.rejects(planLocalRepair(service,p.id,{...input,method:'image-local-edit'}),/media/);
  await assert.rejects(planLocalRepair(service,p.id,{...input,userDirection:''}),/direction/);
  const result=await planLocalRepair(service,p.id,input);
  assert.deepEqual(result.project.runs,p.runs);
  assert.equal(result.plan.status,'PLANNED_NOT_EXECUTED');assert.equal(result.plan.actualCredits,null);
  assert.equal(result.plan.humanApproved,false);assert.equal(result.plan.runtimePromoted,false);
  assert.equal((await service.get(p.id)).localRepairPlans?.length,1);
  assert.ok(localRepairCapabilities.every(c=>!c.automatedExecution));
  // Even an approved source cannot be read after it is replaced on disk.
  await writeFile(path.join(service.directory(p.id),'source.mp4'),'changed');
  await assert.rejects(planLocalRepair(service,p.id,{...input,revision:result.project.revision}),/SHA/);
  p=await service.get(p.id);p.runs[0]!.file='../outside.mp4';await service.save(p);
  await assert.rejects(planLocalRepair(service,p.id,{...input,revision:p.revision}),/project-local/);
 } finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('filmgame-repair-'));
  await rm(root,{recursive:true,force:true});
 }
});
