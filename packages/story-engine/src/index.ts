import type {
  EntityId,
  JsonValue,
  StoryModel,
  ValidationIssue,
  ValidationSummary,
} from '@filmgame/shared-types';
import { validateContinuity } from '@filmgame/consistency-engine';

export type PatchOperation =
  | { op: 'add' | 'replace'; path: string; value: JsonValue }
  | { op: 'remove'; path: string };

export interface AuthoringCommand {
  commandId: string;
  projectId: EntityId;
  baseStoryVersion: number;
  text: string;
  context?: {
    currentEntityId?: EntityId;
    selectedEntityIds?: EntityId[];
  };
}

export type AuthoringIntentType =
  | 'RENAME_OR_RETYPE_CHARACTER'
  | 'CHANGE_CHARACTER_SECRET'
  | 'ADD_RELATIONSHIP'
  | 'CHANGE_SCENE_LOCATION'
  | 'CHANGE_PACING'
  | 'ADD_ENDINGS'
  | 'FIX_ASSET_CONSISTENCY'
  | 'PLAYTEST_PATH'
  | 'GENERAL_STORY_CHANGE';

export interface InterpretedIntent {
  type: AuthoringIntentType;
  confidence: number;
  targetEntityIds: EntityId[];
  requestedChange: string;
  patch: PatchOperation[];
  unresolvedQuestions: string[];
}

export interface IntentInterpreter {
  interpret(command: AuthoringCommand, story: StoryModel): Promise<InterpretedIntent>;
}

export type RegenerationStage =
  | 'STORY_VALIDATION'
  | 'MULTIPLAYER_BALANCE'
  | 'SCRIPT'
  | 'DIRECTOR_BREAKDOWN'
  | 'CHARACTER_REFERENCE'
  | 'LOCATION_REFERENCE'
  | 'STORYBOARD'
  | 'IMAGE'
  | 'VIDEO'
  | 'TTS'
  | 'SUBTITLE'
  | 'MEDIA_RENDER'
  | 'RUNTIME_PACKAGE';

export interface DependencyImpact {
  changedPaths: string[];
  affectedEntityIds: EntityId[];
  stages: RegenerationStage[];
  lockedAssetConflicts: Array<{
    entityId: EntityId;
    path: string;
    reason: string;
  }>;
}

export interface ChangeProposal {
  proposalId: string;
  command: AuthoringCommand;
  intent: InterpretedIntent;
  patch: PatchOperation[];
  preview: StoryModel | null;
  validation: ValidationSummary;
  dependencyImpact: DependencyImpact;
  status: 'READY' | 'NEEDS_INPUT' | 'INVALID' | 'LOCK_CONFLICT';
}

export interface StoryVersionRecord {
  projectId: EntityId;
  version: number;
  parentVersion: number | null;
  commandId: string | null;
  createdAt: string;
  model: StoryModel;
}

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const AUTHORABLE_ROOTS = new Set([
  'brief', 'world', 'narrativeTone', 'visualBible', 'canonicalBible', 'characters',
  'relationships', 'locations', 'variables', 'inventory', 'evidence', 'chapters', 'scenes', 'endings',
]);

export function applyPatch(story: StoryModel, operations: PatchOperation[]): StoryModel {
  const next = structuredClone(story) as unknown as Record<string, unknown>;

  for (const operation of operations) {
    const segments = parsePointer(operation.path);
    if (segments.length === 0) {
      throw new Error('Replacing the story root is not allowed');
    }
    assertSafeKey(segments[0]!);
    if (!AUTHORABLE_ROOTS.has(segments[0]!)) {
      throw new Error(`Patch root ${segments[0]} is controlled by the server and cannot be authored`);
    }

    let parent: unknown = next;
    for (const segment of segments.slice(0, -1)) {
      assertSafeKey(segment);
      parent = readChild(parent, segment, operation.path);
    }

    const key = segments.at(-1)!;
    assertSafeKey(key);
    writeOperation(parent, key, operation);
  }

  return next as unknown as StoryModel;
}

export async function proposeChange(
  story: StoryModel,
  command: AuthoringCommand,
  interpreter: IntentInterpreter = new BuiltInIntentInterpreter(),
): Promise<ChangeProposal> {
  if (story.projectId !== command.projectId) {
    throw new Error(`Command project ${command.projectId} does not match ${story.projectId}`);
  }
  if (story.storyVersion !== command.baseStoryVersion) {
    throw new VersionConflictError(command.baseStoryVersion, story.storyVersion);
  }

  const intent = await interpreter.interpret(command, story);
  const dependencyImpact = analyzeDependencies(story, intent.patch);

  if (intent.unresolvedQuestions.length > 0 || intent.patch.length === 0) {
    return {
      proposalId: `${command.commandId}:proposal`,
      command,
      intent,
      patch: intent.patch,
      preview: null,
      validation: emptyValidation('Authoring intent requires more information'),
      dependencyImpact,
      status: 'NEEDS_INPUT',
    };
  }

  const preview = applyPatch(story, intent.patch);
  preview.parentStoryVersion = story.storyVersion;
  preview.storyVersion = story.storyVersion + 1;
  preview.status = 'DRAFT';
  preview.updatedAt = new Date().toISOString();
  const validation = validateStory(preview);

  return {
    proposalId: `${command.commandId}:proposal`,
    command,
    intent,
    patch: intent.patch,
    preview,
    validation,
    dependencyImpact,
    status: dependencyImpact.lockedAssetConflicts.length
      ? 'LOCK_CONFLICT'
      : validation.valid
        ? 'READY'
        : 'INVALID',
  };
}

export function applyProposal(
  current: StoryModel,
  proposal: ChangeProposal,
): StoryVersionRecord {
  if (proposal.status !== 'READY' || !proposal.preview) {
    throw new Error(`Proposal ${proposal.proposalId} is not ready to apply`);
  }
  if (current.storyVersion !== proposal.command.baseStoryVersion) {
    throw new VersionConflictError(proposal.command.baseStoryVersion, current.storyVersion);
  }

  return {
    projectId: current.projectId,
    version: proposal.preview.storyVersion,
    parentVersion: current.storyVersion,
    commandId: proposal.command.commandId,
    createdAt: new Date().toISOString(),
    model: structuredClone(proposal.preview),
  };
}

export class InMemoryStoryVersionStore {
  readonly #versions = new Map<EntityId, StoryVersionRecord[]>();

  seed(model: StoryModel): StoryVersionRecord {
    if (this.#versions.has(model.projectId)) {
      throw new Error(`Project ${model.projectId} is already seeded`);
    }
    const record: StoryVersionRecord = {
      projectId: model.projectId,
      version: model.storyVersion,
      parentVersion: model.parentStoryVersion ?? null,
      commandId: null,
      createdAt: model.createdAt ?? new Date().toISOString(),
      model: structuredClone(model),
    };
    this.#versions.set(model.projectId, [record]);
    return structuredClone(record);
  }

  latest(projectId: EntityId): StoryVersionRecord | null {
    const records = this.#versions.get(projectId);
    return records?.length ? structuredClone(records.at(-1)!) : null;
  }

  get(projectId: EntityId, version: number): StoryVersionRecord | null {
    const found = this.#versions.get(projectId)?.find((record) => record.version === version);
    return found ? structuredClone(found) : null;
  }

  append(record: StoryVersionRecord): void {
    const records = this.#versions.get(record.projectId);
    if (!records?.length) throw new Error(`Project ${record.projectId} is not seeded`);
    const latest = records.at(-1)!;
    if (record.parentVersion !== latest.version || record.version !== latest.version + 1) {
      throw new VersionConflictError(record.parentVersion ?? -1, latest.version);
    }
    records.push(structuredClone(record));
  }
}

export class VersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`Story version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = 'VersionConflictError';
  }
}

export class BuiltInIntentInterpreter implements IntentInterpreter {
  async interpret(command: AuthoringCommand, story: StoryModel): Promise<InterpretedIntent> {
    const text = command.text.trim();
    const costumeChange = text.match(/^把(.+?)(?:的)?外套改成(.+?)[。.]?$/u);
    if (costumeChange) {
      const label = costumeChange[1]!.trim();
      const requested = costumeChange[2]!.trim();
      const index = story.characters.findIndex(
        (character) => character.name === label || character.publicProfile.role === label,
      );
      if (index >= 0) {
        const character = story.characters[index]!;
        return {
          type: 'GENERAL_STORY_CHANGE',
          confidence: 0.99,
          targetEntityIds: [character.id],
          requestedChange: text,
          patch: [
            {
              op: 'replace',
              path: `/characters/${index}/visual/costume`,
              value: requested.endsWith('外套') ? requested : `${requested}外套`,
            },
          ],
          unresolvedQuestions: [],
        };
      }
    }
    const rename = text.match(/^把(.+?)改成(.+?)[。.]?$/u);
    if (rename) {
      const from = rename[1]!.trim();
      const to = rename[2]!.trim();
      const index = story.characters.findIndex(
        (character) => character.name === from || character.publicProfile.role === from,
      );
      if (index >= 0) {
        const character = story.characters[index]!;
        const field = character.name === from ? 'name' : 'publicProfile/role';
        return {
          type: 'RENAME_OR_RETYPE_CHARACTER',
          confidence: 0.99,
          targetEntityIds: [character.id],
          requestedChange: text,
          patch: [{ op: 'replace', path: `/characters/${index}/${field}`, value: to }],
          unresolvedQuestions: [],
        };
      }
    }

    const villain = text.match(/^(.+?)其实是反派[。.]?$/u);
    if (villain) {
      const label = villain[1]!.trim();
      const index = story.characters.findIndex(
        (character) => character.name === label || character.publicProfile.role === label,
      );
      if (index >= 0) {
        const character = story.characters[index]!;
        return {
          type: 'CHANGE_CHARACTER_SECRET',
          confidence: 0.96,
          targetEntityIds: [character.id],
          requestedChange: text,
          patch: [
            {
              op: 'add',
              path: `/characters/${index}/secrets/-`,
              value: {
                id: `${character.id}-secret-antagonist`,
                summary: '真实立场是幕后反派',
                severity: 'CRITICAL',
              },
            },
          ],
          unresolvedQuestions: [],
        };
      }
    }

    const currentEntityId = command.context?.currentEntityId;
    if (/改到.+(?:停车场|酒店|车站|医院|仓库|天台)/u.test(text) && currentEntityId) {
      const sceneIndex = story.scenes.findIndex((scene) => scene.id === currentEntityId);
      const location = story.locations.find((candidate) => text.includes(candidate.name));
      if (sceneIndex >= 0 && location) {
        return {
          type: 'CHANGE_SCENE_LOCATION',
          confidence: 0.94,
          targetEntityIds: [currentEntityId, location.id],
          requestedChange: text,
          patch: [{ op: 'replace', path: `/scenes/${sceneIndex}/locationId`, value: location.id }],
          unresolvedQuestions: [],
        };
      }
    }

    const type: AuthoringIntentType = /恋爱关系/u.test(text)
      ? 'ADD_RELATIONSHIP'
      : /结局/u.test(text)
        ? 'ADD_ENDINGS'
        : /试玩|路径/u.test(text)
          ? 'PLAYTEST_PATH'
          : /角色不一致|脸不要变/u.test(text)
            ? 'FIX_ASSET_CONSISTENCY'
            : /节奏|缩短/u.test(text)
              ? 'CHANGE_PACING'
              : 'GENERAL_STORY_CHANGE';

    return {
      type,
      confidence: 0.55,
      targetEntityIds: currentEntityId ? [currentEntityId] : [],
      requestedChange: text,
      patch: [],
      unresolvedQuestions: [
        '该命令需要 LLMProvider 生成完整结构化 Patch，或需要更明确的目标实体。',
      ],
    };
  }
}

export function analyzeDependencies(
  story: StoryModel,
  operations: PatchOperation[],
): DependencyImpact {
  const entityIds = new Set<EntityId>();
  const stages = new Set<RegenerationStage>(['STORY_VALIDATION']);
  const conflicts: DependencyImpact['lockedAssetConflicts'] = [];

  for (const operation of operations) {
    const segments = parsePointer(operation.path);
    const [collection, rawIndex] = segments;
    const index = rawIndex === undefined ? Number.NaN : Number(rawIndex);

    if (collection === 'characters' && Number.isInteger(index)) {
      const character = story.characters[index];
      if (character) {
        entityIds.add(character.id);
        addStages(stages, [
          'MULTIPLAYER_BALANCE',
          'SCRIPT',
          'DIRECTOR_BREAKDOWN',
          'CHARACTER_REFERENCE',
          'STORYBOARD',
          'IMAGE',
          'VIDEO',
          'TTS',
          'SUBTITLE',
          'MEDIA_RENDER',
          'RUNTIME_PACKAGE',
        ]);
        if (character.assetLock?.status === 'LOCKED') {
          conflicts.push({
            entityId: character.id,
            path: operation.path,
            reason: 'Character asset is LOCKED; dependent shots require explicit unlock approval.',
          });
        }
      }
    } else if (collection === 'locations' && Number.isInteger(index)) {
      const location = story.locations[index];
      if (location) {
        entityIds.add(location.id);
        addStages(stages, [
          'SCRIPT',
          'DIRECTOR_BREAKDOWN',
          'LOCATION_REFERENCE',
          'STORYBOARD',
          'IMAGE',
          'VIDEO',
          'MEDIA_RENDER',
          'RUNTIME_PACKAGE',
        ]);
        if (location.assetLock.status === 'LOCKED') {
          conflicts.push({
            entityId: location.id,
            path: operation.path,
            reason: 'Location asset is LOCKED; dependent shots require explicit unlock approval.',
          });
        }
      }
    } else if (collection === 'scenes' && Number.isInteger(index)) {
      const scene = story.scenes[index];
      if (scene) entityIds.add(scene.id);
      addStages(stages, [
        'MULTIPLAYER_BALANCE',
        'SCRIPT',
        'DIRECTOR_BREAKDOWN',
        'STORYBOARD',
        'IMAGE',
        'VIDEO',
        'TTS',
        'SUBTITLE',
        'MEDIA_RENDER',
        'RUNTIME_PACKAGE',
      ]);
    } else if (collection === 'endings' || collection === 'variables') {
      addStages(stages, ['MULTIPLAYER_BALANCE', 'SCRIPT', 'RUNTIME_PACKAGE']);
    } else {
      addStages(stages, [
        'MULTIPLAYER_BALANCE',
        'SCRIPT',
        'DIRECTOR_BREAKDOWN',
        'RUNTIME_PACKAGE',
      ]);
    }
  }

  return {
    changedPaths: operations.map((operation) => operation.path),
    affectedEntityIds: [...entityIds],
    stages: [...stages],
    lockedAssetConflicts: conflicts,
  };
}

export function validateStory(story: StoryModel): ValidationSummary {
  const issues: ValidationIssue[] = [];
  const roleIds = new Set(story.characters.map((character) => character.id));
  const locationIds = new Set(story.locations.map((location) => location.id));
  const sceneIds = new Set(story.scenes.map((scene) => scene.id));
  const endingIds = new Set(story.endings.map((ending) => ending.id));

  if (story.brief.playerCount !== story.characters.length) {
    issues.push(error('PLAYER_COUNT_MISMATCH', '玩家人数必须与角色数量一致。'));
  }

  const allIds = [
    ...story.characters.map((entity) => entity.id),
    ...story.locations.map((entity) => entity.id),
    ...story.scenes.map((entity) => entity.id),
    ...story.endings.map((entity) => entity.id),
    ...story.variables.map((entity) => entity.id),
    ...story.inventory.map((entity) => entity.id),
    ...story.evidence.map((entity) => entity.id),
  ];
  const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  for (const id of new Set(duplicateIds)) {
    issues.push(error('DUPLICATE_ENTITY_ID', `实体 ID 重复：${id}`, id));
  }

  for (const chapter of story.chapters) {
    for (const sceneId of chapter.sceneIds) {
      if (!sceneIds.has(sceneId)) {
        issues.push(error('MISSING_CHAPTER_SCENE', `章节 ${chapter.id} 引用了不存在的场景 ${sceneId}`, chapter.id));
      }
    }
  }

  const actionCountByRole = Object.fromEntries([...roleIds].map((roleId) => [roleId, 0]));
  for (const scene of story.scenes) {
    if (!locationIds.has(scene.locationId)) {
      issues.push(error('MISSING_SCENE_LOCATION', `场景 ${scene.id} 的地点不存在`, scene.id));
    }
    for (const roleId of scene.rolesPresent) {
      if (!roleIds.has(roleId)) {
        issues.push(error('MISSING_SCENE_ROLE', `场景 ${scene.id} 引用了不存在的角色 ${roleId}`, scene.id));
      }
    }
    for (const [roleId, actions] of Object.entries(scene.availableActionsByRole)) {
      if (!roleIds.has(roleId)) {
        issues.push(error('ACTION_ROLE_NOT_FOUND', `动作属于不存在的角色 ${roleId}`, scene.id));
      } else {
        actionCountByRole[roleId] = (actionCountByRole[roleId] ?? 0) + actions.length;
      }
    }
    for (const nextId of scene.nextSceneCandidates) {
      if (!sceneIds.has(nextId)) {
        issues.push(error('MISSING_NEXT_SCENE', `场景 ${scene.id} 指向不存在的场景 ${nextId}`, scene.id));
      }
    }
    for (const rule of scene.resolutionRules) {
      if (rule.nextSceneId && !sceneIds.has(rule.nextSceneId)) {
        issues.push(error('RULE_NEXT_SCENE_NOT_FOUND', `规则 ${rule.id} 指向不存在的场景`, scene.id));
      }
      if (rule.endingId && !endingIds.has(rule.endingId)) {
        issues.push(error('RULE_ENDING_NOT_FOUND', `规则 ${rule.id} 指向不存在的结局`, scene.id));
      }
    }
  }

  if (story.endings.length < story.brief.endingTarget) {
    issues.push({
      code: 'ENDING_TARGET_NOT_MET',
      severity: 'WARNING',
      message: `目标结局数为 ${story.brief.endingTarget}，当前只有 ${story.endings.length}。`,
    });
  }

  const startSceneId = [...story.chapters].sort((a, b) => a.order - b.order)[0]?.sceneIds[0];
  const reachableScenes = startSceneId ? walkScenes(startSceneId, story) : new Set<EntityId>();
  for (const sceneId of sceneIds) {
    if (!reachableScenes.has(sceneId)) {
      issues.push({
        code: 'UNREACHABLE_SCENE',
        severity: 'WARNING',
        message: `场景 ${sceneId} 从开场不可达。`,
        entityId: sceneId,
      });
    }
  }

  const reachableEndingIds = new Set<EntityId>();
  for (const scene of story.scenes) {
    if (!reachableScenes.has(scene.id)) continue;
    for (const rule of scene.resolutionRules) {
      if (rule.endingId) reachableEndingIds.add(rule.endingId);
    }
  }
  for (const endingId of endingIds) {
    if (!reachableEndingIds.has(endingId)) {
      issues.push({
        code: 'UNREACHABLE_ENDING',
        severity: 'ERROR',
        message: `结局 ${endingId} 没有可达的触发规则。`,
        entityId: endingId,
      });
    }
  }

  const counts = Object.values(actionCountByRole);
  const maxCount = Math.max(0, ...counts);
  const participationScoreByRole = Object.fromEntries(
    Object.entries(actionCountByRole).map(([roleId, count]) => [
      roleId,
      maxCount === 0 ? 0 : count / maxCount,
    ]),
  );
  for (const [roleId, score] of Object.entries(participationScoreByRole)) {
    if (score < 0.65) {
      issues.push({
        code: 'PARTICIPATION_IMBALANCE',
        severity: 'WARNING',
        message: `角色 ${roleId} 的可执行动作参与度明显偏低。`,
        entityId: roleId,
      });
    }
  }

  issues.push(...validateContinuity(story).issues);

  return {
    validatedAt: new Date().toISOString(),
    valid: !issues.some((issue) => issue.severity === 'ERROR'),
    issues,
    reachableEndingIds: [...reachableEndingIds],
    participationScoreByRole,
  };
}

function emptyValidation(message: string): ValidationSummary {
  return {
    validatedAt: new Date().toISOString(),
    valid: false,
    issues: [{ code: 'INTENT_INCOMPLETE', severity: 'INFO', message }],
  };
}

function error(code: string, message: string, entityId?: EntityId): ValidationIssue {
  return entityId
    ? { code, severity: 'ERROR', message, entityId }
    : { code, severity: 'ERROR', message };
}

function walkScenes(start: EntityId, story: StoryModel): Set<EntityId> {
  const byId = new Map(story.scenes.map((scene) => [scene.id, scene]));
  const visited = new Set<EntityId>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const scene = byId.get(id);
    if (!scene) continue;
    for (const next of scene.nextSceneCandidates) queue.push(next);
  }
  return visited;
}

function addStages(target: Set<RegenerationStage>, stages: RegenerationStage[]): void {
  for (const stage of stages) target.add(stage);
}

function parsePointer(path: string): string[] {
  if (!path.startsWith('/')) throw new Error(`Invalid JSON pointer: ${path}`);
  return path
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function assertSafeKey(key: string): void {
  if (BLOCKED_KEYS.has(key)) throw new Error(`Unsafe patch key: ${key}`);
}

function readChild(parent: unknown, key: string, path: string): unknown {
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Array index out of range in ${path}`);
    }
    return parent[index];
  }
  if (parent && typeof parent === 'object' && key in parent) {
    return (parent as Record<string, unknown>)[key];
  }
  throw new Error(`Patch path does not exist: ${path}`);
}

function writeOperation(parent: unknown, key: string, operation: PatchOperation): void {
  if (Array.isArray(parent)) {
    if (operation.op === 'add' && key === '-') {
      parent.push(structuredClone(operation.value));
      return;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`Invalid array index ${key}`);
    }
    if (operation.op === 'remove') parent.splice(index, 1);
    else parent[index] = structuredClone(operation.value);
    return;
  }

  if (!parent || typeof parent !== 'object') {
    throw new Error('Patch parent must be an object or array');
  }
  const record = parent as Record<string, unknown>;
  if (operation.op === 'remove') {
    if (!(key in record)) throw new Error(`Patch key does not exist: ${key}`);
    delete record[key];
  } else {
    record[key] = structuredClone(operation.value);
  }
}
