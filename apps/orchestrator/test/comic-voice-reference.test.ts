import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComicService } from '../src/comic-service.js';
import { bindVoiceReference } from '../src/comic-voice-reference.js';
import { MediaPipeline } from '../../../services/media-pipeline/src/index.js';

test('voice binding preserves adopted scene and requires exact audio, actor and user evidence', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'filmgame-voice-'));
  const media=new MediaPipeline({ffmpegPath:'unused',ffprobePath:'unused'});
  media.probe=async()=>({streams:[{codec_type:'audio'}]});
  const service=new ComicService({root,llm:null,video:null,dreamina:null,media});
  try {
    let p=await service.create({idea:'Village captain.',style:'film',ratio:'16:9',episodeCount:1,episodeSeconds:15});
    p=await service.apply(p.id,{title:'Village',logline:'Conflict',visualStyle:'film',characters:[{id:'captain',name:'Captain',appearance:'mature soldier',voice:'deep'}],episodes:[{id:'e1',title:'Village',synopsis:'Conflict',shots:[{id:'s1',scene:'Village',description:'Command',camera:'Push in',durationSeconds:12,characterIds:['captain'],dialogue:[]}]}]},p.revision);
    const scene={nodeId:'node_scene',file:'scene.png',mediaType:'image' as const,role:'adopted composition'};
    p.shotReferences={s1:[scene]};p.shotReferenceOnly={s1:true};await service.save(p);
    p=await service.get(p.id);
    const data=Buffer.from('audio fixture'),sha256=createHash('sha256').update(data).digest('hex');
    const input={revision:p.revision,shotId:'s1',characterId:'captain',data,sha256,userFeedback:'Accept this direction, slightly deeper veteran.',performanceDirection:'Slightly deeper veteran delivery',ledger:'audio receipt'};
    await assert.rejects(bindVoiceReference(service,p.id,{...input,sha256:'0'.repeat(64)}),/SHA/);
    await assert.rejects(bindVoiceReference(service,p.id,{...input,userFeedback:''}),/feedback/);
    await assert.rejects(bindVoiceReference(service,p.id,{...input,characterId:'stranger'}),/not in/);
    await assert.rejects(bindVoiceReference(service,p.id,{...input,revision:-1}),/revision/);
    p=await bindVoiceReference(service,p.id,input);
    assert.deepEqual(p.shotReferences!.s1![0],scene);
    assert.equal(p.shotReferenceOnly!.s1,true);
    assert.equal(p.shotReferences!.s1![1]!.voiceReview!.finalPerformanceApproved,false);
    assert.equal(p.runs.length,0);
    p=await bindVoiceReference(service,p.id,{...input,revision:p.revision});
    assert.equal(p.shotReferences!.s1!.length,2);
    media.probe=async()=>({streams:[{codec_type:'video'}]});
    await assert.rejects(bindVoiceReference(service,p.id,{...input,revision:p.revision}),/Audio-only/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('filmgame-voice-'));
    await rm(root,{recursive:true,force:true});
  }
});
