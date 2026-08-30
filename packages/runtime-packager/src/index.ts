import { createHash } from 'node:crypto';

import type { JsonValue, StoryModel } from '@filmgame/shared-types';

export interface RuntimePackageOptions {
  runtimeVersion: number;
  assetManifestUri: string;
  videoAssetIdByEntityId?: Record<string, string>;
  bibleVersion?: number;
  promptVersion?: string;
  workflowVersion?: string;
  buildVersion?: string;
}

export interface BuiltRuntimePackage {
  runtime: Record<string, JsonValue>;
  json: string;
  bytes: Uint8Array;
  sha256: string;
}

export function buildRuntimePackage(
  story: StoryModel,
  options: RuntimePackageOptions,
): BuiltRuntimePackage {
  if (!Number.isInteger(options.runtimeVersion) || options.runtimeVersion < 1) {
    throw new Error('runtimeVersion must be a positive integer');
  }
  const firstChapter = [...story.chapters].sort((left, right) => left.order - right.order)[0];
  const initialSceneId = firstChapter?.sceneIds[0];
  if (!initialSceneId) throw new Error('Story has no initial scene');
  const videoAsset = (entityId: string): string =>
    options.videoAssetIdByEntityId?.[entityId] ?? `video-${entityId}`;
  const runtime = {
    schemaVersion: '1.0.0',
    projectId: story.projectId,
    storyVersion: story.storyVersion,
    runtimeVersion: options.runtimeVersion,
    bibleVersion: options.bibleVersion ?? story.canonicalBible?.bibleVersion ?? story.storyVersion,
    promptVersion: options.promptVersion ?? 'v1',
    workflowVersion: options.workflowVersion ?? 'production-dag-v1',
    buildVersion: options.buildVersion ?? `${story.storyVersion}.${options.runtimeVersion}.0`,
    playerCount: story.brief.playerCount,
    initialSceneId,
    roles: story.characters.map((character) => ({
      id: character.id,
      displayName: character.name,
      publicProfile: `${character.publicProfile.role}：${character.publicProfile.summary}`,
      secretSummaries: character.secrets.map((secret) => secret.summary),
      goalSummaries: character.goals.map((goal) => goal.description),
      victoryConditionSummaries: character.victoryConditions.map((condition) => condition.description),
    })),
    initialState: {
      sceneId: initialSceneId,
      phase: 'LOBBY',
      variables: Object.fromEntries(
        story.variables.map((variable) => [variable.id, variable.initialValue]),
      ),
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
    },
    scenes: story.scenes.map((scene) => ({
      id: scene.id,
      videoAssetId: videoAsset(scene.id),
      rolesPresent: scene.rolesPresent,
      publicInformation: scene.publicInformation,
      privateInformationByRole: scene.privateInformationByRole,
      availableActionsByRole: Object.fromEntries(
        Object.entries(scene.availableActionsByRole).map(([roleId, actions]) => [
          roleId,
          actions.map((action) => ({
            id: action.id,
            label: action.label,
            intentType: action.intentType,
            inputMode: action.inputMode,
          })),
        ]),
      ),
      resolutionRules: scene.resolutionRules.map((rule) => ({
        id: rule.id,
        priority: rule.priority,
        condition: rule.when,
        mutations: rule.mutations,
        ...(rule.nextSceneId ? { nextSceneId: rule.nextSceneId } : {}),
        ...(rule.endingId ? { endingId: rule.endingId } : {}),
      })),
      stateMutationsOnEnter: scene.stateMutationsOnEnter ?? [],
      nextSceneCandidates: scene.nextSceneCandidates,
      timing: {
        discussionSeconds: scene.timing.discussionSeconds,
        decisionSeconds: scene.timing.decisionSeconds,
      },
      fallbackBehavior: scene.fallbackBehavior,
    })),
    endings: story.endings.map((ending) => ({
      id: ending.id,
      videoAssetId: videoAsset(ending.id),
      condition: ending.condition,
      priority: ending.priority,
      resultsByRole: ending.characterResults,
    })),
    assetManifestUri: options.assetManifestUri,
  } as unknown as Record<string, JsonValue>;
  const json = `${JSON.stringify(runtime, null, 2)}\n`;
  const bytes = new TextEncoder().encode(json);
  return {
    runtime,
    json,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
