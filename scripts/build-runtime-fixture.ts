import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import type { StoryModel } from '@filmgame/shared-types';

const story = JSON.parse(
  await readFile(new URL('../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

const runtime = {
  schemaVersion: '1.0.0',
  projectId: story.projectId,
  storyVersion: story.storyVersion,
  runtimeVersion: 1,
  playerCount: story.brief.playerCount,
  initialSceneId: [...story.chapters].sort((left, right) => left.order - right.order)[0]!.sceneIds[0],
  roles: story.characters.map((character) => ({
    id: character.id,
    displayName: character.name,
    publicProfile: `${character.publicProfile.role}：${character.publicProfile.summary}`,
    secretSummaries: character.secrets.map((secret) => secret.summary),
    goalSummaries: character.goals.map((goal) => goal.description),
    victoryConditionSummaries: character.victoryConditions.map((condition) => condition.description),
  })),
  initialState: {
    sceneId: [...story.chapters].sort((left, right) => left.order - right.order)[0]!.sceneIds[0],
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
    videoAssetId: `video-${scene.id}`,
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
    videoAssetId: `video-${ending.id}`,
    condition: ending.condition,
    priority: ending.priority,
    resultsByRole: ending.characterResults,
  })),
  assetManifestUri: 'asset-manifest.json',
};

const runtimeJson = `${JSON.stringify(runtime, null, 2)}\n`;
const runtimeBytes = new TextEncoder().encode(runtimeJson);
const runtimeHash = `sha256:${createHash('sha256').update(runtimeBytes).digest('hex')}`;
const emptyHash = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const videoAssets = [
  ...story.scenes.map((scene) => ({ id: `video-${scene.id}`, entityType: 'SCENE', entityId: scene.id })),
  ...story.endings.map((ending) => ({ id: `video-${ending.id}`, entityType: 'ENDING', entityId: ending.id })),
];
const manifest = {
  schemaVersion: '1.0.0',
  manifestVersion: 1,
  projectId: story.projectId,
  storyVersion: story.storyVersion,
  productionVersion: 1,
  generatedAt: new Date().toISOString(),
  assets: [
    {
      id: 'runtime-data',
      type: 'RUNTIME_DATA',
      uri: 'runtime-package.json',
      mimeType: 'application/json',
      sizeBytes: runtimeBytes.byteLength,
      sha256: runtimeHash,
      status: 'GENERATED',
      dependencies: [],
      source: 'BUILT',
      providerMetadata: { provider: 'filmgame-runtime-packager' },
      license: { commercialUseApproved: true, licenseId: 'FIRST_PARTY' },
    },
    ...videoAssets.map((asset) => ({
      id: asset.id,
      type: 'FINAL_SCENE',
      uri: `missing://${asset.id}.mp4`,
      mimeType: 'video/mp4',
      sizeBytes: 0,
      sha256: emptyHash,
      status: 'MISSING',
      dependencies: [],
      source: 'GENERATED',
      entityType: asset.entityType,
      entityId: asset.entityId,
      providerMetadata: { provider: 'unconfigured' },
      license: { commercialUseApproved: false },
    })),
  ],
  runtimePackages: [
    {
      id: 'runtime-package-dev',
      target: 'UNREAL_WINDOWS',
      version: '0.1.0-dev',
      entryAssetId: 'runtime-data',
      assetIds: ['runtime-data', ...videoAssets.map((asset) => asset.id)],
      sha256: runtimeHash,
      status: 'BUILDING',
    },
  ],
  metadata: {
    fixture: true,
    publishable: false,
    reason: 'Media providers are not configured; scene video assets are explicitly MISSING.',
  },
};

const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
const exampleDirectory = new URL('../examples/snowbound-hotel/', import.meta.url);
const unrealDirectory = new URL('../unreal/FilmGameClient/Content/FilmGame/', import.meta.url);
await Promise.all([
  mkdir(exampleDirectory, { recursive: true }),
  mkdir(unrealDirectory, { recursive: true }),
]);
await Promise.all([
  writeFile(new URL('runtime-package.json', exampleDirectory), runtimeJson),
  writeFile(new URL('asset-manifest.json', exampleDirectory), manifestJson),
  writeFile(new URL('runtime-package.json', unrealDirectory), runtimeJson),
  writeFile(new URL('asset-manifest.json', unrealDirectory), manifestJson),
]);

console.log(`Generated development runtime fixture ${runtimeHash}.`);
