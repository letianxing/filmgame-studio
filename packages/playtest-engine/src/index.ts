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
  balance: MultiplayerBalanceReport;
  truncated: boolean;
}

export interface RoleBalanceMetrics {
  actionCount: number;
  privateInformationCount: number;
  importantDecisionCount: number;
  scenePresence: number;
  influenceScore: number;
  winOpportunity: number;
  maximumIdleScenes: number;
}

export interface MultiplayerBalanceWarning {
  code: 'UNDERUTILIZED_ROLE' | 'OVERPOWERED_ROLE' | 'PASSIVE_ROLE' | 'INFORMATION_STARVATION';
  roleId: EntityId;
  message: string;
}

export interface MultiplayerBalanceReport {
  metricsByRole: Record<EntityId, RoleBalanceMetrics>;
  participationHeatmap: Record<EntityId, Record<EntityId, {
    present: boolean;
    actionCount: number;
    privateInformationCount: number;
  }>>;
  warnings: MultiplayerBalanceWarning[];
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
    balance: analyzeMultiplayerBalance(story),
    truncated: frontier.length > 0,
  };
}

export function analyzeMultiplayerBalance(story: StoryModel): MultiplayerBalanceReport {
  const metricsByRole: Record<EntityId, RoleBalanceMetrics> = {};
  const participationHeatmap: MultiplayerBalanceReport['participationHeatmap'] = {};
  for (const character of story.characters) {
    let actionCount = 0;
    let privateInformationCount = 0;
    let importantDecisionCount = 0;
    let scenePresence = 0;
    let maximumIdleScenes = 0;
    let currentIdle = 0;
    for (const scene of story.scenes) {
      const present = scene.rolesPresent.includes(character.id);
      const actions = scene.availableActionsByRole[character.id] ?? [];
      const privateInfo = scene.privateInformationByRole[character.id] ?? [];
      participationHeatmap[scene.id] ??= {};
      participationHeatmap[scene.id]![character.id] = {
        present,
        actionCount: actions.length,
        privateInformationCount: privateInfo.length,
      };
      if (present) scenePresence += 1;
      actionCount += actions.length;
      privateInformationCount += privateInfo.length;
      importantDecisionCount += actions.filter((action) =>
        scene.resolutionRules.some((rule) => conditionMentions(rule.when, action.id)),
      ).length;
      if (!present || actions.length === 0) {
        currentIdle += 1;
        maximumIdleScenes = Math.max(maximumIdleScenes, currentIdle);
      } else {
        currentIdle = 0;
      }
    }
    const influenceScore =
      actionCount + importantDecisionCount * 2 + privateInformationCount + scenePresence * 0.5;
    metricsByRole[character.id] = {
      actionCount,
      privateInformationCount,
      importantDecisionCount,
      scenePresence,
      influenceScore,
      winOpportunity: character.victoryConditions.length,
      maximumIdleScenes,
    };
  }
  const scores = Object.values(metricsByRole).map((metric) => metric.influenceScore);
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const warnings: MultiplayerBalanceWarning[] = [];
  for (const [roleId, metric] of Object.entries(metricsByRole)) {
    if (average > 0 && metric.influenceScore < average * 0.6) {
      warnings.push({ code: 'UNDERUTILIZED_ROLE', roleId, message: `${roleId} influence is below 60% of average.` });
    }
    if (average > 0 && metric.influenceScore > average * 1.6) {
      warnings.push({ code: 'OVERPOWERED_ROLE', roleId, message: `${roleId} influence exceeds 160% of average.` });
    }
    if (metric.importantDecisionCount === 0 || metric.maximumIdleScenes >= 3) {
      warnings.push({ code: 'PASSIVE_ROLE', roleId, message: `${roleId} has no important decision or is idle for ${metric.maximumIdleScenes} scenes.` });
    }
    if (metric.privateInformationCount === 0) {
      warnings.push({ code: 'INFORMATION_STARVATION', roleId, message: `${roleId} receives no private scene information.` });
    }
  }
  return { metricsByRole, participationHeatmap, warnings };
}

function conditionMentions(condition: import('@filmgame/shared-types').Condition, value: string): boolean {
  if ('all' in condition) return condition.all.some((child) => conditionMentions(child, value));
  if ('any' in condition) return condition.any.some((child) => conditionMentions(child, value));
  if ('not' in condition) return conditionMentions(condition.not, value);
  return condition.value === value || condition.path.includes(value);
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
