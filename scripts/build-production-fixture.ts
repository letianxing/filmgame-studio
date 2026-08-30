import { readFile, writeFile } from 'node:fs/promises';

import { createProductionPlan, type SceneBreakdown } from '@filmgame/orchestrator';
import type { StoryModel } from '@filmgame/shared-types';

const story = JSON.parse(
  await readFile(new URL('../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

const sceneBreakdowns: SceneBreakdown[] = story.scenes.map((scene) => ({
  sceneId: scene.id,
  shots: [
    {
      id: `shot-${scene.id}-wide`,
      sceneId: scene.id,
      characterIds: scene.rolesPresent,
      locationId: scene.locationId,
      description: `${scene.title}的空间建立镜头`,
      dialogue: [],
      camera: '35mm wide, locked frame, slow push-in',
      durationSeconds: 8,
      imagePrompt: `${story.visualBible.style}，${scene.title}，空间建立镜头`,
      videoPrompt: `${story.visualBible.cinematography}，缓慢推进，保持角色与地点一致`,
    },
    {
      id: `shot-${scene.id}-dialogue`,
      sceneId: scene.id,
      characterIds: scene.rolesPresent.slice(0, 2),
      locationId: scene.locationId,
      description: `${scene.title}的关键对白与反应镜头`,
      dialogue: [
        {
          characterId: scene.rolesPresent[0]!,
          text: scene.script ?? scene.summary ?? scene.title,
        },
      ],
      camera: '50mm medium close-up with reverse reaction',
      durationSeconds: 8,
      imagePrompt: `${story.visualBible.style}，${scene.title}，克制表演，中近景`,
      videoPrompt: `${story.visualBible.cinematography}，自然微表情，轻微手持`,
    },
  ],
}));

const endingBreakdowns: SceneBreakdown[] = story.endings.map((ending) => ({
  sceneId: ending.id,
  entityType: 'ENDING',
  shots: [
    {
      id: `shot-${ending.id}-resolution`,
      sceneId: ending.id,
      characterIds: Object.keys(ending.characterResults),
      locationId: story.locations[0]!.id,
      description: `${ending.title}：${ending.summary}`,
      dialogue: [
        {
          characterId: Object.keys(ending.characterResults)[0]!,
          text: ending.summary,
        },
      ],
      camera: '50mm cinematic resolution tableau, controlled slow pull-back',
      durationSeconds: 8,
      imagePrompt: `${story.visualBible.style}，结局：${ending.title}，${ending.summary}`,
      videoPrompt: `${story.visualBible.cinematography}，结局收束，缓慢拉远`,
    },
  ],
}));

const breakdowns = [...sceneBreakdowns, ...endingBreakdowns];

const plan = createProductionPlan(story, 1, breakdowns);
const production = {
  schemaVersion: '1.0.0',
  projectId: story.projectId,
  storyVersion: story.storyVersion,
  productionVersion: 1,
  status: 'PLANNING',
  directorTreatment: {
    visualLanguage: story.visualBible.style,
    cameraGrammar: story.visualBible.cinematography,
    performanceDirection: '克制表演，以停顿、视线和微动作传达角色隐瞒的信息。',
    editingRhythm: '前段长镜头积压不信任，证据出现后缩短镜头并增加反应切换。',
    soundDirection: '暴雪低频、建筑管道声与近距离呼吸构成主要声场。',
    continuityRules: ['角色面部、发型与冬季服装必须继承 LOCKED reference', '地点朝向与关键道具位置固定'],
  },
  characters: story.characters.map((character) => ({
    characterId: character.id,
    appearancePrompt: character.visual.promptTemplate ?? `${character.visual.appearance}，${character.visual.costume}`,
    negativeConstraints: character.visual.constraints,
    costumeVariants: [character.visual.costume],
    voiceProfile: {
      voiceId: character.voice.voiceId ?? null,
      referenceAssetId: character.voice.voiceReferenceAssetId ?? null,
      language: character.voice.language,
      style: character.voice.speakingStyle,
      emotion: character.voice.emotion,
      speed: character.voice.speed,
    },
    assetLock: {
      status: character.assetLock?.status ?? 'DRAFT',
      revision: character.assetLock?.revision ?? 1,
      canonicalReferenceAssetIds: character.assetLock?.referenceAssetIds ?? [],
    },
    providerMetadata: { provider: 'unconfigured' },
  })),
  locations: story.locations.map((location) => ({
    locationId: location.id,
    visualPrompt: location.visual,
    negativeConstraints: location.constraints ?? [],
    assetLock: {
      status: location.assetLock.status,
      revision: location.assetLock.revision,
      canonicalReferenceAssetIds: location.assetLock.referenceAssetIds,
    },
    providerMetadata: { provider: 'unconfigured' },
  })),
  scenes: breakdowns.map((breakdown) => {
    const scene = story.scenes.find((candidate) => candidate.id === breakdown.sceneId);
    const ending = story.endings.find((candidate) => candidate.id === breakdown.sceneId);
    if (!scene && !ending) throw new Error(`Unknown production unit ${breakdown.sceneId}`);
    return {
      sceneId: breakdown.sceneId,
      title: scene?.title ?? ending!.title,
      locationId: scene?.locationId ?? story.locations[0]!.id,
      script: scene?.script ?? scene?.summary ?? ending!.summary,
      status: 'BLOCKED',
      shots: breakdown.shots.map((shot) => ({
        id: shot.id,
        sceneId: shot.sceneId,
        characters: shot.characterIds,
        location: shot.locationId,
        description: shot.description,
        dialogue: shot.dialogue,
        camera: shot.camera,
        shotSize: shot.id.endsWith('wide') ? 'LS' : 'MCU',
        cameraMovement: shot.id.endsWith('wide') ? 'slow push-in' : 'subtle handheld',
        duration: shot.durationSeconds,
        imagePrompt: shot.imagePrompt,
        videoPrompt: shot.videoPrompt,
        referenceImages: [],
        voiceAssets: [],
        subtitle: [],
        sfx: ['暴雪', '建筑低频'],
        bgm: ['低频氛围铺底'],
        status: 'BLOCKED',
        retryCount: 0,
        providerMetadata: { provider: 'unconfigured' },
      })),
    };
  }),
  jobs: plan.graph.list().map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    dependencies: job.dependencies,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    ...(job.error ? { error: job.error } : {}),
    providerMetadata: { provider: 'unconfigured' },
  })),
  estimatedCost: { currency: 'USD', amount: 0 },
  actualCost: { currency: 'USD', amount: 0 },
};

await writeFile(
  new URL('../examples/snowbound-hotel/production.json', import.meta.url),
  `${JSON.stringify(production, null, 2)}\n`,
);

console.log(`Generated production fixture with ${production.scenes.length} scene/ending units and ${production.jobs.length} jobs.`);
