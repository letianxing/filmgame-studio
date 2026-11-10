import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ComicService } from '../src/comic-service.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';
import { REVIEW_GATES, configureAgentReview, recordAgentReview, acceptedReviewActor, type AgentReviewInput } from '../src/comic-agent-review.js';
import { bindReferenceSet } from '../src/comic-reference-import.js';

test('delegation is explicit; exact source, evidence, all gates and actor survive approval', async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'filmgame-agent-review-'));
 const service=new ComicService({root,llm:null,video:null,dreamina:null,media:new MediaPipeline({ffmpegPath:'unused',ffprobePath:'unused'})});
 try {
  let p=await service.create({idea:'A village in morning',style:'film',ratio:'16:9',episodeCount:1,episodeSeconds:15});
  p=await service.apply(p.id,{title:'Village',logline:'Morning',visualStyle:'film',characters:[{id:'hero',name:'Hero',appearance:'coat',voice:'silent'}],episodes:[{id:'e',title:'Morning',synopsis:'Arrival',shots:[{id:'s',scene:'Village',description:'Arrival',camera:'Wide',durationSeconds:4,characterIds:[],dialogue:[]}]}]},p.revision);
  const bytes=Buffer.from('fixture'); const sha=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(service.directory(p.id),'candidate.png'),bytes);
  p.runs.push({id:'candidate',shotId:'s',kind:'REFERENCE',provider:'external',status:'REVIEW',storyVersion:p.storyVersion,inputHash:service.hash(p,'s'),createdAt:new Date().toISOString(),file:'candidate.png',sha256:sha}); await service.save(p);
  const input:AgentReviewInput={runId:'candidate',sha256:sha,inputHash:service.hash(p,'s'),decision:'APPROVED',reviewer:'test-agent',reason:'All checks inspected',gates:Object.fromEntries(REVIEW_GATES.map(g=>[g,'PASS'])),evidence:[{reference:'fixture-review.json',sha256:sha}]};
  await assert.rejects(recordAgentReview(service,p.id,input),/not delegated/);
  await configureAgentReview(service,p.id,true,'User explicitly authorized autonomous reviews');
  await assert.rejects(recordAgentReview(service,p.id,{...input,sha256:'0'.repeat(64)}),/revision/);
  await assert.rejects(recordAgentReview(service,p.id,{...input,evidence:[]}),/Evidence/);
  await assert.rejects(recordAgentReview(service,p.id,{...input,gates:{...input.gates,audio:'UNVERIFIED'}}),/every gate/);
  await writeFile(path.join(service.directory(p.id),'candidate.png'),'changed');
  await assert.rejects(recordAgentReview(service,p.id,input),/bytes changed/);
  await writeFile(path.join(service.directory(p.id),'candidate.png'),bytes);
  p=await recordAgentReview(service,p.id,input);
  assert.equal(p.runs[0]!.reviewDecision!.actor,'AUTHORIZED_AGENT');
  assert.equal(acceptedReviewActor(p.runs[0]!),true);
  await assert.rejects(recordAgentReview(service,p.id,input),/immutable/);
  p=await bindReferenceSet(service,p.id,{revision:p.revision,shotId:'s',targetInputHash:service.hash(p,'s'),referenceOnly:true,references:[{runId:'candidate',sha256:sha,sourceInputHash:input.inputHash,role:'Approved original frame'}]});
  assert.equal(p.shotReferences!.s![0]!.sha256,sha);
  const forged=structuredClone(p.runs[0]!); delete forged.reviewDecision!.agentReview;
  assert.equal(acceptedReviewActor(forged),false);
  await configureAgentReview(service,p.id,false,'User revoked agent review');
  await assert.rejects(recordAgentReview(service,p.id,input),/not delegated/);
 } finally {await rm(root,{recursive:true,force:true});}
});

