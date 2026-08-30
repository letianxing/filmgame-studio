import { createHash } from 'node:crypto';

import { resolveScene } from '@filmgame/resolution-engine';
import type {
  EntityId,
  JsonValue,
  RuntimeGameState,
  StoryModel,
  StoryScene,
  SubmittedAction,
} from '@filmgame/shared-types';

export interface BotPlaytestOptions {
  maxTransitions?: number;
  maxDepth?: number;
  maxVariantsPerScene?: number;
}

export interface BotPlaytestPath {
  pathId: string;
  sceneIds: EntityId[];
  ruleIds: EntityId[];
  endingId?: EntityId;
}

export interface BotPlaytestReport {
  completedAt: string;
  transitionsEvaluated: number;
  paths: BotPlaytestPath[];
  endingCoverage: Record<EntityId, number>;
  sceneVisits: Record<EntityId, number>;
  actionsByRole: Record<EntityId, number>;
  errors: Array<{ sceneId: EntityId; message: string }>;
  truncated: boolean;
}

interface FrontierNode {
  state: RuntimeGameState;
  sceneIds: EntityId[];
  ruleIds: EntityId[];
  depth: number;
}

export function runDeterministicBotPlaytest(
  story: StoryModel,
  options: BotPlaytestOptions = {},
): BotPlaytestReport {
  const maxTransitions = boundedInteger(options.maxTransitions ?? 256, 1, 10_000);
  const maxDepth = boundedInteger(options.maxDepth ?? 64, 1, 1_000);
  const maxVariants = boundedInteger(options.maxVariantsPerScene ?? 32, 1, 512);
  const firstSceneId = [...story.chapters].sort((left, right) => left.order - right.order)[0]
    ?.sceneIds[0];
  if (!firstSceneId) throw new Error('Story has no initial scene');
  const frontier: FrontierNode[] = [
    { state: createInitialState(story, firstSceneId), sceneIds: [], ruleIds: [], depth: 0 },
  ];
  const visited = new Set<string>();
  const paths: BotPlaytestPath[] = [];
  const endingCoverage: Record<EntityId, number> = {};
  const sceneVisits: Record<EntityId, number> = {};
  const actionsByRole: Record<EntityId, number> = Object.fromEntries(
    story.characters.map((character) => [character.id, 0]),
  );
  const errors: BotPlaytestReport['errors'] = [];
  let transitionsEvaluated = 0;

  while (frontier.length && transitionsEvaluated < maxTransitions) {
    const node = frontier.shift()!;
    if (node.depth >= maxDepth || node.state.phase === 'ENDING') continue;
    const scene = story.scenes.find((candidate) => candidate.id === node.state.sceneId);
    if (!scene) {
      errors.push({ sceneId: node.state.sceneId, message: 'Scene not found' });
      continue;
    }
    const visitKey = stateKey(node.state);
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    sceneVisits[scene.id] = (sceneVisits[scene.id] ?? 0) + 1;

    for (const actions of actionVariants(scene).slice(0, maxVariants)) {
      if (transitionsEvaluated >= maxTransitions) break;
      transitionsEvaluated += 1;
      for (const action of actions) {
        actionsByRole[action.roleId] = (actionsByRole[action.roleId] ?? 0) + 1;
      }
      try {
        const resolved = resolveScene({
          roomId: 'bot-playtest',
          scene,
          state: node.state,
          actions,
          now: new Date(0).toISOString(),
        });
        const nextPath: BotPlaytestPath = {
          pathId: '',
          sceneIds: [...node.sceneIds, scene.id],
          ruleIds: [...node.ruleIds, resolved.matchedRuleId],
          ...(resolved.state.endingId ? { endingId: resolved.state.endingId } : {}),
        };
        nextPath.pathId = createHash('sha256')
          .update(JSON.stringify([nextPath.sceneIds, nextPath.ruleIds, nextPath.endingId ?? null]))
          .digest('hex')
          .slice(0, 16);
        if (resolved.state.phase === 'ENDING' && resolved.state.endingId) {
          paths.push(nextPath);
          endingCoverage[resolved.state.endingId] =
            (endingCoverage[resolved.state.endingId] ?? 0) + 1;
        } else {
          frontier.push({
            state: resolved.state,
            sceneIds: nextPath.sceneIds,
            ruleIds: nextPath.ruleIds,
            depth: node.depth + 1,
          });
        }
      } catch (cause) {
        errors.push({
          sceneId: scene.id,
          message: cause instanceof Error ? cause.message : 'Resolution failed',
        });
      }
    }
  }

  return {
    completedAt: new Date().toISOString(),
    transitionsEvaluated,
    paths,
    endingCoverage,
    sceneVisits,
    actionsByRole,
    errors,
    truncated: frontier.length > 0,
  };
}

function actionVariants(scene: StoryScene): SubmittedAction[][] {
  const roles = scene.rolesPresent.filter(
    (roleId) => (scene.availableActionsByRole[roleId] ?? []).length > 0,
  );
  const baseline = roles.map((roleId) => toSubmitted(roleId, scene.availableActionsByRole[roleId]![0]!.id));
  const variants: SubmittedAction[][] = [baseline];
  for (const [roleIndex, roleId] of roles.entries()) {
    const actions = scene.availableActionsByRole[roleId] ?? [];
    for (const action of actions.slice(1)) {
      const variant = baseline.map((submitted) => ({ ...submitted }));
      variant[roleIndex] = toSubmitted(roleId, action.id);
      variants.push(variant);
    }
  }
  return variants;
}

function toSubmitted(roleId: EntityId, actionId: EntityId): SubmittedAction {
  return { roleId, actionId, submittedAt: new Date(0).toISOString() };
}

function createInitialState(story: StoryModel, sceneId: EntityId): RuntimeGameState {
  return {
    sceneId,
    phase: 'PLAYING',
    variables: Object.fromEntries(
      story.variables.map((variable) => [variable.id, structuredClone(variable.initialValue)]),
    ) as Record<string, JsonValue>,
    relationships: Object.fromEntries(
      story.relationships.map((relationship) => [relationship.id, relationship.initialTrust]),
    ),
    evidenceByRole: Object.fromEntries(
      story.characters.map((character) => [character.id, character.startingEvidenceIds ?? []]),
    ),
    inventoryByRole: Object.fromEntries(
      story.characters.map((character) => [character.id, character.startingInventoryIds ?? []]),
    ),
    revealedSecrets: [],
    historySequence: 0,
    submittedActions: {},
  };
}

function stateKey(state: RuntimeGameState): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sceneId: state.sceneId,
        variables: state.variables,
        relationships: state.relationships,
        evidenceByRole: state.evidenceByRole,
        inventoryByRole: state.inventoryByRole,
        revealedSecrets: state.revealedSecrets,
      }),
    )
    .digest('hex');
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Value ${value} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
