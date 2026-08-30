import type {
  LLMProvider,
  ProviderContext,
  ProviderResult,
} from '@filmgame/provider-sdk';
import type {
  JsonValue,
  StoryModel,
  ValidationSummary,
} from '@filmgame/shared-types';
import { validateStory } from '@filmgame/story-engine';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import storySchemaDocument from '../../../packages/story-schema/story.schema.json' with { type: 'json' };

export type StoryAgentName =
  | 'PRODUCER'
  | 'NARRATIVE_DESIGNER'
  | 'CHARACTER_WRITER'
  | 'MULTIPLAYER_GAME_DESIGNER'
  | 'SCRIPT_WRITER';

export interface StoryWorkflowTrace {
  node: StoryAgentName;
  provider: string;
  model?: string;
  requestId: string;
  startedAt: string;
  completedAt: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StoryGenerationResult {
  story: StoryModel;
  validation: ValidationSummary;
  trace: StoryWorkflowTrace[];
}

export class StoryGenerationError extends Error {
  constructor(
    message: string,
    readonly validation?: ValidationSummary,
  ) {
    super(message);
    this.name = 'StoryGenerationError';
  }
}

export class StoryGenerationWorkflow {
  constructor(readonly llm: LLMProvider) {}

  async generate(input: {
    projectId: string;
    idea: string;
    playerLanguage?: string;
    context: Omit<ProviderContext, 'projectId' | 'storyVersion' | 'idempotencyKey'>;
  }): Promise<StoryGenerationResult> {
    if (input.idea.trim().length < 40) {
      throw new StoryGenerationError('The creative brief must contain at least 40 characters');
    }
    const language = input.playerLanguage ?? 'zh-CN';
    const trace: StoryWorkflowTrace[] = [];
    const call = async (
      node: StoryAgentName,
      schema: Record<string, JsonValue>,
      system: string,
      prompt: string,
    ): Promise<Record<string, JsonValue>> => {
      const validate = schemaValidator.compile(schema);
      let validationHint = '';
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = await this.llm.generateStructured<JsonValue>(
          {
            system,
            prompt: validationHint ? `${prompt}\n\n上一次输出未通过 Schema：${validationHint}\n请修正后完整重写。` : prompt,
            jsonSchema: schema,
            temperature: node === 'MULTIPLAYER_GAME_DESIGNER' ? 0.25 : 0.45,
            maxOutputTokens: 24_000,
          },
          {
            ...input.context,
            projectId: input.projectId,
            storyVersion: 1,
            idempotencyKey: `${input.projectId}:story-v1:${node}:attempt-${attempt}`,
            metadata: { node, language, attempt },
          },
        );
        trace.push(toTrace(node, result));
        const record = requireRecord(result.data, node);
        if (validate(record)) return record;
        validationHint = schemaValidator.errorsText(validate.errors, { separator: '; ' }).slice(0, 2_000);
      }
      throw new StoryGenerationError(`${node} failed schema validation after one repair: ${validationHint}`);
    };

    const producer = await call(
      'PRODUCER',
      producerSchema,
      '你是互动影游制片人。只输出符合 Schema 的项目范围，不写场景和对白。玩家人数必须为 4～8。',
      `以 ${language} 分析以下创意，生成 Project Brief：\n\n${input.idea}`,
    );
    const narrative = await call(
      'NARRATIVE_DESIGNER',
      narrativeSchema,
      '你是多人互动影游叙事设计师。建立世界、基调、视觉圣经、地点和章节骨架；不要生成角色秘密或裁决规则。所有 ID 使用小写 kebab-case。',
      contextPrompt(input.idea, { producer }),
    );
    const characters = await call(
      'CHARACTER_WRITER',
      characterSchema,
      '你是角色编剧。为每位玩家生成公开身份、私密秘密、个人目标、独立胜利条件、关系、视觉和声音约束。角色数必须等于 brief.playerCount。所有 ID 使用小写 kebab-case。',
      contextPrompt(input.idea, { producer, narrative }),
    );
    const gameplay = await call(
      'MULTIPLAYER_GAME_DESIGNER',
      gameplaySchema,
      '你是多人游戏设计师。生成变量、道具、证据、场景、角色专属动作、确定性 ResolutionRule、状态变化和至少目标数量的有效结局。禁止简单多数投票；禁止让 LLM 在运行时直接修改状态。',
      contextPrompt(input.idea, { producer, narrative, characters }),
    );
    const scripts = await call(
      'SCRIPT_WRITER',
      scriptSchema,
      '你是电影编剧。只为已有 sceneId 写可拍摄的场景剧本与对白，不改变规则、ID、角色秘密或分支拓扑。',
      contextPrompt(input.idea, { producer, narrative, characters, gameplay }),
    );

    const story = mergeStory(input.projectId, producer, narrative, characters, gameplay, scripts);
    const validation = validateStory(story);
    story.validation = validation;
    if (!validation.valid) {
      throw new StoryGenerationError(
        `Generated Story Model failed deterministic validation with ${validation.issues.length} issue(s)`,
        validation,
      );
    }
    return { story, validation, trace };
  }
}

function mergeStory(
  projectId: string,
  producer: Record<string, JsonValue>,
  narrative: Record<string, JsonValue>,
  characters: Record<string, JsonValue>,
  gameplay: Record<string, JsonValue>,
  scripts: Record<string, JsonValue>,
): StoryModel {
  const sceneScripts = new Map(
    requireArray(scripts.scripts, 'scripts').map((entry) => {
      const record = requireRecord(entry, 'SCRIPT_WRITER.scripts[]');
      return [String(record.sceneId), String(record.script)] as const;
    }),
  );
  const gameplayScenes = requireArray(gameplay.scenes, 'gameplay.scenes').map((entry) => {
    const scene = requireRecord(entry, 'gameplay.scenes[]');
    return { ...scene, script: sceneScripts.get(String(scene.id)) ?? '' };
  });
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0.0',
    projectId,
    storyVersion: 1,
    parentStoryVersion: null,
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    brief: producer.brief,
    world: narrative.world,
    narrativeTone: narrative.narrativeTone,
    visualBible: narrative.visualBible,
    locations: narrative.locations,
    chapters: narrative.chapters,
    characters: characters.characters,
    relationships: characters.relationships,
    variables: gameplay.variables,
    inventory: gameplay.inventory,
    evidence: gameplay.evidence,
    scenes: gameplayScenes,
    endings: gameplay.endings,
  } as unknown as StoryModel;
}

function contextPrompt(idea: string, context: Record<string, JsonValue>): string {
  return `创作意图：\n${idea}\n\n已经批准的上游结构：\n${JSON.stringify(context)}`;
}

function toTrace(node: StoryAgentName, result: ProviderResult<JsonValue>): StoryWorkflowTrace {
  const usage = result.usage?.find((candidate) => candidate.unit === 'TOKENS');
  return {
    node,
    provider: result.provider,
    ...(result.model ? { model: result.model } : {}),
    requestId: result.requestId,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
  };
}

function requireRecord(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoryGenerationError(`${label} must return a JSON object`);
  }
  return value;
}

function requireArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new StoryGenerationError(`${label} must be an array`);
  return value;
}

interface ValidationFunction {
  (data: unknown): boolean;
  errors?: unknown;
}

interface SchemaValidator {
  compile(schema: unknown): ValidationFunction;
  errorsText(errors: unknown, options?: { separator?: string }): string;
}

const Ajv2020 = Ajv2020Module as unknown as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => SchemaValidator;
const addFormats = addFormatsModule as unknown as (validator: SchemaValidator) => SchemaValidator;
const schemaValidator = addFormats(new Ajv2020({ allErrors: true, strict: false }));
const storyDefinitions = (storySchemaDocument as unknown as { $defs: Record<string, JsonValue> }).$defs;

const producerSchema = storyFragment({ brief: ref('projectBrief') });

const narrativeSchema = storyFragment({
  world: ref('world'),
  narrativeTone: ref('narrativeTone'),
  visualBible: ref('visualBible'),
  locations: array(ref('location'), 1),
  chapters: array(ref('chapter'), 1),
});

const characterSchema = storyFragment({
  characters: array(ref('character'), 4, 8),
  relationships: array(ref('relationship')),
});

const gameplaySchema = storyFragment({
  variables: array(ref('variable')),
  inventory: array(ref('inventoryItem')),
  evidence: array(ref('evidence')),
  scenes: array(ref('scene'), 1),
  endings: array(ref('ending'), 1),
});

const scriptSchema = schema({
  scripts: array(
    object(['sceneId', 'script'], { sceneId: string(), script: string() }),
    1,
  ),
});

function schema(properties: Record<string, JsonValue>): Record<string, JsonValue> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function object(required: string[], properties: Record<string, JsonValue>): Record<string, JsonValue> {
  return { type: 'object', additionalProperties: false, required, properties };
}

function storyFragment(properties: Record<string, JsonValue>): Record<string, JsonValue> {
  return { ...schema(properties), $defs: storyDefinitions };
}

function ref(definition: string): Record<string, JsonValue> {
  return { $ref: `#/$defs/${definition}` };
}

function string(): Record<string, JsonValue> {
  return { type: 'string', minLength: 1 };
}

function array(
  items: Record<string, JsonValue>,
  minItems = 0,
  maxItems?: number,
): Record<string, JsonValue> {
  return {
    type: 'array',
    items,
    minItems,
    ...(maxItems === undefined ? {} : { maxItems }),
  };
}
