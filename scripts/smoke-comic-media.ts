/** Local deterministic smoke: uses test patterns, never a paid provider. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ComicService } from '../apps/orchestrator/src/comic-service.js';
import { MediaPipeline } from '../services/media-pipeline/src/index.js';
import type { ComicStory } from '../packages/comic-engine/src/index.js';

const env=await readFile('.env.local','utf8');
const setting=(key:string) => process.env[key] ?? env.split(/\r?\n/).find(l=>l.startsWith(`${key}=`))?.slice(key.length+1) ?? '';
const media=new MediaPipeline({ffmpegPath:setting('FFMPEG_PATH'),ffprobePath:setting('FFPROBE_PATH'),defaultVideoCodec:setting('MEDIA_VIDEO_CODEC') || 'libopenh264'});
const root=path.resolve('.local/comic-media-smoke',randomUUID());await mkdir(root,{recursive:true});
const service=new ComicService({root,media,llm:null,video:null,dreamina:null});
let project=await service.create({idea:'A deterministic integration validation fixture.',style:'test pattern',ratio:'9:16',episodeCount:1,episodeSeconds:15});
const story:ComicStory={title:'Media smoke test',logline:'Technical fixture',visualStyle:'test',characters:[{id:'c1',name:'Test',appearance:'test',voice:'test'}],episodes:[{id:'ep1',title:'Test',synopsis:'Test',shots:[1,2].map(i=>({id:`s${i}`,scene:'test',description:'test',camera:'fixed',durationSeconds:4,characterIds:['c1'],dialogue:[{characterId:'c1',text:`Test caption ${i}`,startSeconds:1,endSeconds:3}]}))}]};
project=await service.apply(project.id,story,project.revision);
for(const shot of story.episodes[0]!.shots){const id=randomUUID();const file=`${id}.mp4`;const target=path.join(service.directory(project.id),file);await media.createTestPattern({outputPath:target,width:360,height:640,durationSeconds:4});project.runs.push({id,shotId:shot.id,provider:'seedance',status:'APPROVED',storyVersion:1,inputHash:service.hash(project,shot.id),file,sha256:createHash('sha256').update(await readFile(target)).digest('hex'),durationSeconds:4,createdAt:new Date().toISOString()});}
await service.save(project);project=await service.exportEpisode(project.id,'ep1');
const output=project.exports[0]!;const probe=await media.probe(path.join(service.directory(project.id),output.file));
assert.ok(probe.streams?.some(s=>s.codec_type==='video'));assert.ok(probe.streams?.some(s=>s.codec_type==='audio'));assert.ok(probe.streams?.some(s=>s.codec_name==='mov_text'));
const srt=await readFile(path.join(service.directory(project.id),output.subtitles),'utf8');assert.match(srt,/00:00:05[,.]\d{3} --> 00:00:07/);
assert.equal(service.exportIsCurrent(project,output),true);
console.log(JSON.stringify({passed:true,duration:probe.format?.duration,streams:probe.streams?.map(s=>s.codec_type),file:path.join(service.directory(project.id),output.file)}));
