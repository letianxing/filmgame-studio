import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePrompt, validateComic, type ComicStory } from '../../../packages/comic-engine/src/index.js';

function fixture(): ComicStory {
  return { title:'Village', logline:'Command and reaction', visualStyle:'film',
    characters:[{id:'captain',name:'什长',appearance:'甲',voice:'低沉'}],
    episodes:[{id:'e1',title:'Village',synopsis:'Command',shots:[{
      id:'s1',scene:'村口',description:'守兵接令',camera:'近景',durationSeconds:4,
      characterIds:['captain'],dialogue:[{characterId:'captain',text:'住手！',startSeconds:0,endSeconds:1}],
    }]}] };
}

test('legacy prompt remains byte-identical and explicit on-screen is equivalent',()=>{
  const story=fixture(),shot=story.episodes[0]!.shots[0]!;
  const expected=[
    '制作动态漫剧镜头，保持真实连续动作，禁止静态幻灯片。风格：film',
    'captain / 什长：甲；声音：低沉','场景：村口','表演：守兵接令','镜头：近景',
    '0–1秒，什长用中文说：“住手！”。口型与对白同步。',
    '原生生成上述对白与同期环境音；未安排对白的镜头不说话，不添加旁白或额外台词。只让指定说话者在指定时间开口，其他人嘴闭合。保持角色外形与声音一致。配乐统一在后期制作，本镜头不生成音乐。不要生成画面文字、水印、字幕。',
  ].join('\n');
  validateComic(story);
  assert.equal(nativePrompt(story,shot),expected);
  shot.dialogue[0]!.delivery='on_screen';
  validateComic(story);
  assert.equal(nativePrompt(story,shot),expected);
});

test('mixed delivery keeps lip sync only on the on-screen line',()=>{
  const story=fixture(),shot=story.episodes[0]!.shots[0]!;
  shot.dialogue[0]!.delivery='off_screen';
  shot.dialogue.push({characterId:'captain',text:'退开。',startSeconds:1,endSeconds:2,delivery:'on_screen'});
  validateComic(story);
  const prompt=nativePrompt(story,shot);
  assert.match(prompt,/什长在画外用中文说：“住手！”/);
  assert.match(prompt,/说话者此时不入画/);
  assert.match(prompt,/什长用中文说：“退开。”。口型与对白同步/);
  assert.equal(prompt.match(/。口型与对白同步/g)?.length,1);
  assert.ok(!prompt.includes('只让指定说话者在指定时间开口'));
});

test('voice over is not staged as an audible in-scene speaker; enum and timeline remain validated',()=>{
  const story=fixture(),shot=story.episodes[0]!.shots[0]!;
  shot.dialogue[0]!.delivery='voice_over';
  validateComic(story);
  assert.match(nativePrompt(story,shot),/不作现场发声/);
  assert.ok(!nativePrompt(story,shot).includes('。口型与对白同步。'));
  const bad=structuredClone(story) as any;
  bad.episodes[0].shots[0].dialogue[0].delivery='guess';
  assert.throws(()=>validateComic(bad),/allowed values/);
  shot.dialogue[0]!.endSeconds=5;
  assert.throws(()=>validateComic(story),/时间轴无效/);
});
