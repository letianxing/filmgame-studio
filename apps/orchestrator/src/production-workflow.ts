import type { LLMProvider, ProviderContext, ProviderResult } from '@filmgame/provider-sdk';
import type { JsonValue, StoryModel } from '@filmgame/shared-types';

import {
  createProductionPlan,
  type ProductionPlan,
  type SceneBreakdown,
  type ShotBreakdown,
} from './index.js';

export interface DirectorTrace {
  sceneId: string;
  provider: string;
  model?: string;
  requestId: string;
  shotCount: number;
}

export interface ProductionPlanningResult {
  breakdowns: SceneBreakdown[];
  plan: ProductionPlan;
  trace: DirectorTrace[];
}

export class ProductionPlanningWorkflow {
  constructor(readonly llm: LLMProvider) {}

  async plan(input: {
    story: StoryModel;
    productionVersion: number;
    context: Omit<ProviderContext, 'projectId' | 'storyVersion' | 'productionVersion' | 'idempotencyKey'>;
    concurrency?: number;
  }): Promise<ProductionPlanningResult> {
    const concurrency = Math.max(1, Math.min(input.concurrency ?? 3, 8));
    const breakdowns: SceneBreakdown[] = [];
    const trace: DirectorTrace[] = [];

    const units = [
      ...input.story.scenes.map((scene) => ({
        id: scene.id,
        entityType: 'SCENE' as const,
        subject: scene,
        characterIds: scene.rolesPresent,
        locationId: scene.locationId,
        targetDurationSeconds: scene.timing.videoDurationSeconds ?? 30,
      })),
      ...input.story.endings.map((ending) => ({
        id: ending.id,
        entityType: 'ENDING' as const,
        subject: ending,
        characterIds: Object.keys(ending.characterResults),
        locationId: input.story.locations[0]?.id ?? '',
        targetDurationSeconds: 20,
      })),
    ];

    for (let offset = 0; offset < units.length; offset += concurrency) {
      const batch = units.slice(offset, offset + concurrency);
      const results = await Promise.all(
        batch.map(async (unit) => {
          const result = await this.llm.generateStructured<JsonValue>(
            {
              system:
                '你是电影导演。把一个已批准场景分解为可独立生成和剪辑的 Shot List。不得改变故事规则或角色秘密。每个镜头必须继承角色与地点约束，时长之和应接近场景视频时长。',
              prompt: JSON.stringify({
                visualBible: input.story.visualBible,
                narrativeTone: input.story.narrativeTone,
                entityType: unit.entityType,
                subject: unit.subject,
                targetDurationSeconds: unit.targetDurationSeconds,
                characters: input.story.characters.filter((character) =>
                  unit.characterIds.includes(character.id),
                ),
                location: input.story.locations.find((location) => location.id === unit.locationId),
              }),
              jsonSchema: shotListSchema,
              temperature: 0.35,
              maxOutputTokens: 12_000,
            },
            {
              ...input.context,
              projectId: input.story.projectId,
              storyVersion: input.story.storyVersion,
              productionVersion: input.productionVersion,
              idempotencyKey: `${input.story.projectId}:production-${input.productionVersion}:director:${unit.entityType.toLowerCase()}:${unit.id}`,
              metadata: { node: 'DIRECTOR', sceneId: unit.id, entityType: unit.entityType },
            },
          );
          const record = requireRecord(result.data, `Director output for ${unit.id}`);
          const shots = requireArray(record.shots, `Director shots for ${unit.id}`).map(
            (entry) => normalizeShot(requireRecord(entry, `Shot in ${unit.id}`), unit.id),
          );
          if (!shots.length) throw new Error(`Director produced no shots for ${unit.id}`);
          return {
            breakdown: { sceneId: unit.id, entityType: unit.entityType, shots },
            result,
          };
        }),
      );
      for (const { breakdown, result } of results) {
        breakdowns.push(breakdown);
        trace.push(toTrace(breakdown, result));
      }
    }

    return {
      breakdowns,
      plan: createProductionPlan(input.story, input.productionVersion, breakdowns),
      trace,
    };
  }
}

function normalizeShot(record: Record<string, JsonValue>, expectedSceneId: string): ShotBreakdown {
  const sceneId = String(record.sceneId);
  if (sceneId !== expectedSceneId) {
    throw new Error(`Director returned shot for ${sceneId}, expected ${expectedSceneId}`);
  }
  return {
    id: String(record.id),
    sceneId,
    characterIds: requireStringArray(record.characterIds, 'characterIds'),
    locationId: String(record.locationId),
    description: String(record.description),
    dialogue: requireArray(record.dialogue, 'dialogue').map((entry) => {
      const line = requireRecord(entry, 'dialogue line');
      return { characterId: String(line.characterId), text: String(line.text) };
    }),
    camera: String(record.camera),
    durationSeconds: Number(record.durationSeconds),
    imagePrompt: String(record.imagePrompt),
    videoPrompt: String(record.videoPrompt),
  };
}

function toTrace(
  breakdown: SceneBreakdown,
  result: ProviderResult<JsonValue>,
): DirectorTrace {
  return {
    sceneId: breakdown.sceneId,
    provider: result.provider,
    ...(result.model ? { model: result.model } : {}),
    requestId: result.requestId,
    shotCount: breakdown.shots.length,
  };
}

function requireRecord(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireStringArray(value: JsonValue | undefined, label: string): string[] {
  const values = requireArray(value, label);
  if (!values.every((entry) => typeof entry === 'string')) throw new Error(`${label} must contain strings`);
  return values as string[];
}

const shotListSchema: Record<string, JsonValue> = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    shots: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'sceneId',
          'characterIds',
          'locationId',
          'description',
          'dialogue',
          'camera',
          'durationSeconds',
          'imagePrompt',
          'videoPrompt',
        ],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$' },
          sceneId: { type: 'string' },
          characterIds: { type: 'array', items: { type: 'string' } },
          locationId: { type: 'string' },
          description: { type: 'string', minLength: 1 },
          dialogue: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['characterId', 'text'],
              properties: { characterId: { type: 'string' }, text: { type: 'string' } },
            },
          },
          camera: { type: 'string', minLength: 1 },
          durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
          imagePrompt: { type: 'string', minLength: 1 },
          videoPrompt: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};
