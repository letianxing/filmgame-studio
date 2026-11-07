import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ComicService} from '../src/comic-service.js';
import {MediaPipeline} from '../../../services/media-pipeline/src/index.js';
import {planLocalRepair,localRepairCapabilities} from '../src/comic-local-repair.js';

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
