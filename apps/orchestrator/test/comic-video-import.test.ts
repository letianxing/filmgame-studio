import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ComicService } from '../src/comic-service.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';
import { importVideoDerivative } from '../src/comic-video-import.js';

test('derivative preserves source decision, verifies exact bytes, stays pending and deduplicates', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'filmgame-video-import-'));
 const media=new MediaPipeline({ffmpegPath:'unused',ffprobePath:'unused'});
 let valid=true;
 media.validateTechnical=async()=>({valid,issues:[],durationSeconds:4.125});
 const service=new ComicService({root,llm:null,video:null,dreamina:null,media});
 const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 try {
  let p=await service.create({idea:'A village in morning',style:'film',ratio:'16:9',episodeCount:1,episodeSeconds:15});
  p=await service.apply(p.id,{title:'Village',logline:'Morning',visualStyle:'film',characters:[{id:'hero',name:'Hero',appearance:'coat',voice:'silent'}],episodes:[{id:'e',title:'Morning',synopsis:'Arrival',shots:[{id:'s',scene:'Village',description:'Arrival',camera:'Wide',durationSeconds:5,characterIds:[],dialogue:[]}]}]},p.revision);
  const original=Buffer.from('source'),data=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisomDERIVATIVE')]);
  await writeFile(path.join(service.directory(p.id),'source.mp4'),original);
  p.runs.push({id:'source',shotId:'s',provider:'dreamina',status:'REVIEW',inputHash:service.hash(p,'s'),storyVersion:p.storyVersion,createdAt:new Date().toISOString(),file:'source.mp4',sha256:sha(original),durationSeconds:9}); await service.save(p);
  const input={revision:p.revision,sourceRunId:'source',sourceSha256:sha(original),targetInputHash:service.hash(p,'s'),data,sha256:sha(data),editDescription:'Shortened occlusion',ledger:'edit.json',durationSeconds:4.125};
  await assert.rejects(importVideoDerivative(service,p.id,{...input,revision:-1}),/revision/);
  await assert.rejects(importVideoDerivative(service,p.id,{...input,sha256:'bad'}),/bounded MP4/);
  await assert.rejects(importVideoDerivative(service,p.id,{...input,targetInputHash:'bad'}),/exact input/);
  await writeFile(path.join(service.directory(p.id),'source.mp4'),'changed');
  await assert.rejects(importVideoDerivative(service,p.id,input),/bytes changed/);
  await writeFile(path.join(service.directory(p.id),'source.mp4'),original);
  await assert.rejects(importVideoDerivative(service,p.id,{...input,sourceInterval:{startSeconds:8,endSeconds:12.125}}),/Source interval/);
  await assert.rejects(importVideoDerivative(service,p.id,{...input,sourceInterval:{startSeconds:2,endSeconds:3}}),/Source interval/);
  const before=await readdir(service.directory(p.id)); valid=false;
  await assert.rejects(importVideoDerivative(service,p.id,input),/technical validation/);
  assert.deepEqual(await readdir(service.directory(p.id)),before); valid=true;
  p=await importVideoDerivative(service,p.id,input);
  assert.equal(p.runs.length,2); assert.equal(p.runs[0]!.status,'REVIEW');
  const r=p.runs[1]!; assert.equal(r.status,'REVIEW'); assert.equal(r.reviewDecision,undefined);
  assert.equal(r.credits,undefined); assert.equal(r.durationSeconds,4.125);
  assert.equal(r.derivative!.sourceSha256,sha(original));
  p=await importVideoDerivative(service,p.id,{...input,revision:p.revision}); assert.equal(p.runs.length,2);
  await assert.rejects(importVideoDerivative(service,p.id,{...input,revision:p.revision,sourceInterval:{startSeconds:2,endSeconds:6.125}}),/provenance differs/);
 } finally {await rm(root,{recursive:true,force:true});}
});


