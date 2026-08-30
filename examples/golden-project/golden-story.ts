import type { Character, StoryModel, StoryScene } from '@filmgame/shared-types';

export const goldenIdea =
  '创建一款4人、15分钟的悬疑互动影游。暴雨封锁的灯塔中，记者、刑警、医生和守塔人必须找出失踪者真相，每人拥有秘密、行动和独立胜利机会，至少三个结局。';

const roleIds = ['journalist', 'detective', 'doctor', 'keeper'] as const;

function character(id: (typeof roleIds)[number], role: string): Character {
  return {
    id,
    name: role,
    publicProfile: { role, summary: `${role}来到灯塔调查失踪案。` },
    secrets: [{ id: `${id}-secret`, summary: `${role}隐瞒了一段关键经历。`, severity: 'HIGH' }],
    goals: [{ id: `${id}-goal`, description: `${role}必须保护自己的秘密并推动真相。`, priority: 80 }],
    victoryConditions: [{ id: `${id}-victory`, description: `${role}参与最终裁决。`, condition: { path: 'variables.culprit-exposed', operator: 'EXISTS' }, score: 10 }],
    startingEvidenceIds: id === 'journalist' ? ['evidence-log'] : [],
    startingInventoryIds: id === 'keeper' ? ['prop-lighthouse-key'] : [],
    visual: {
      appearance: `${role}，写实电影人物`, face: `${role}固定面部参考`, hair: '被雨打湿的深色头发',
      body: '自然成年人身形', costume: `${role}防水外套`, constraints: ['保持面部和服装一致'],
    },
    voice: {
      voiceId: `${id}-preset-voice`, language: 'zh-CN', speakingStyle: '克制、紧张', emotion: 'suspense', speed: 1,
    },
    assetLock: { status: 'DRAFT', revision: 1, referenceAssetIds: [], constraints: [] },
  };
}

function actions(sceneId: string) {
  return Object.fromEntries(
    roleIds.map((roleId) => [
      roleId,
      [{ id: `${sceneId}-${roleId}-act`, label: `${roleId}行动`, intentType: 'investigate', inputMode: 'NONE' as const }],
    ]),
  );
}

function privateInfo(sceneId: string) {
  return Object.fromEntries(roleIds.map((roleId) => [roleId, [`${sceneId}中只有${roleId}知道的线索。`]]));
}

const common = {
  chapterId: 'chapter-one',
  locationId: 'lighthouse',
  rolesPresent: [...roleIds],
  publicInformation: ['暴雨切断了灯塔与外界的联系。'],
  timing: { discussionSeconds: 30, decisionSeconds: 20, videoDurationSeconds: 8 },
  fallbackBehavior: { onTimeout: 'AI_BOT' as const, onInvalidResolution: 'PAUSE_ROOM' as const },
};

const scenes: StoryScene[] = [
  {
    ...common,
    id: 'scene-arrival', title: '抵达灯塔', privateInformationByRole: privateInfo('scene-arrival'),
    availableActionsByRole: actions('scene-arrival'), nextSceneCandidates: ['scene-accusation'],
    resolutionRules: [{
      id: 'rule-arrival', priority: 10,
      when: { path: 'actions.journalist.actionId', operator: 'EQ', value: 'scene-arrival-journalist-act' },
      mutations: [{ operation: 'SET', path: 'variables.culprit-exposed', value: true }],
      nextSceneId: 'scene-accusation',
    }],
  },
  {
    ...common,
    id: 'scene-accusation', title: '公开指控', privateInformationByRole: privateInfo('scene-accusation'),
    availableActionsByRole: actions('scene-accusation'), nextSceneCandidates: ['scene-escape'],
    resolutionRules: [
      {
        id: 'rule-truth', priority: 30,
        when: { path: 'actions.detective.actionId', operator: 'EQ', value: 'scene-accusation-detective-act' },
        mutations: [], endingId: 'ending-truth',
      },
      {
        id: 'rule-coverup', priority: 20,
        when: { path: 'actions.keeper.actionId', operator: 'EQ', value: 'scene-accusation-keeper-act' },
        mutations: [], endingId: 'ending-coverup',
      },
      {
        id: 'rule-escape', priority: 1,
        when: { path: 'variables.culprit-exposed', operator: 'EXISTS' },
        mutations: [], nextSceneId: 'scene-escape',
      },
    ],
  },
  {
    ...common,
    id: 'scene-escape', title: '逃离风暴', privateInformationByRole: privateInfo('scene-escape'),
    availableActionsByRole: actions('scene-escape'), nextSceneCandidates: [],
    resolutionRules: [{
      id: 'rule-survival', priority: 1,
      when: { path: 'actions.doctor.actionId', operator: 'EQ', value: 'scene-escape-doctor-act' },
      mutations: [], endingId: 'ending-survival',
    }],
  },
];

export function createGoldenStory(projectId = 'golden-lighthouse'): StoryModel {
  return {
    schemaVersion: '1.0.0', projectId, storyVersion: 1, parentStoryVersion: null, status: 'DRAFT',
    createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
    brief: {
      title: '暴雨灯塔', logline: goldenIdea, genre: ['悬疑'], playerCount: 4,
      targetDurationMinutes: 15, interactionStyle: ['讨论', '欺骗', '合作'], endingTarget: 3,
    },
    world: { premise: '暴雨中的孤立灯塔发生失踪案。', timePeriod: '现代暴雨夜', setting: '海岸灯塔', rules: ['通信中断', '所有行动由服务器规则裁决'] },
    narrativeTone: { keywords: ['冷峻', '压抑', '写实'], pacing: '紧凑三幕', contentRating: '16+', dialogueGuidance: '克制、留白' },
    visualBible: { style: '写实电影感', palette: ['冷蓝', '锈红'], cinematography: '2.39:1低照度手持摄影', lighting: '灯塔旋转光与闪电', aspectRatio: '16:9', negativeConstraints: ['卡通', '角色漂移'] },
    characters: [character('journalist', '记者'), character('detective', '刑警'), character('doctor', '医生'), character('keeper', '守塔人')],
    relationships: roleIds.slice(1).map((roleId, index) => ({
      id: `relationship-${index + 1}`, fromCharacterId: 'journalist', toCharacterId: roleId,
      publicLabel: '调查同伴', privateTruth: '彼此并不完全信任', initialTrust: 0,
    })),
    locations: [{
      id: 'lighthouse', name: '海岸灯塔', description: '三层石砌灯塔，单一旋转楼梯连接机房与灯室。',
      visual: '潮湿石墙、铁门、旋转灯和暴雨海面', constraints: ['门窗与楼梯布局固定'],
      assetLock: { status: 'DRAFT', revision: 1, referenceAssetIds: [], constraints: [] },
    }],
    variables: [{ id: 'culprit-exposed', type: 'BOOLEAN', initialValue: false, visibility: 'SERVER_ONLY' }],
    inventory: [{ id: 'prop-lighthouse-key', name: '灯塔钥匙', description: '开启机房铁门的黄铜钥匙。', transferable: true }],
    evidence: [{ id: 'evidence-log', name: '值班日志', description: '记录停电前后的异常时间。', authenticity: 'AUTHENTIC', sourceSceneId: 'scene-arrival' }],
    chapters: [{ id: 'chapter-one', title: '暴雨之夜', order: 1, targetDurationMinutes: 15, sceneIds: scenes.map((scene) => scene.id) }],
    scenes,
    endings: [
      { id: 'ending-truth', title: '真相公开', summary: '证据被公开。', condition: { path: 'variables.culprit-exposed', operator: 'EQ', value: true }, priority: 30, characterResults: Object.fromEntries(roleIds.map((id) => [id, '面对公开真相'])) },
      { id: 'ending-coverup', title: '秘密沉海', summary: '真相被掩盖。', condition: { path: 'variables.culprit-exposed', operator: 'EXISTS' }, priority: 20, characterResults: Object.fromEntries(roleIds.map((id) => [id, '背负秘密离开'])) },
      { id: 'ending-survival', title: '黎明生还', summary: '众人在黎明前逃离。', condition: { path: 'variables.culprit-exposed', operator: 'EXISTS' }, priority: 10, characterResults: Object.fromEntries(roleIds.map((id) => [id, '幸存并保留选择'])) },
    ],
  };
}
