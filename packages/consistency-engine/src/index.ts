import { createHash } from 'node:crypto';

import type {
  AssetLock,
  CanonicalBible,
  CanonicalBibleRecord,
  EntityId,
  JsonValue,
  StoryModel,
  ValidationIssue,
} from '@filmgame/shared-types';

export interface ContinuityReport {
  valid: boolean;
  bible: CanonicalBible;
  issues: ValidationIssue[];
  categoryCounts: Record<string, number>;
}

export function transitionAssetLock(
  lock: AssetLock,
  target: AssetLock['status'],
  options: { at?: string; overrideReason?: string } = {},
): AssetLock {
  const allowed: Record<AssetLock['status'], AssetLock['status'][]> = {
    DRAFT: ['REVIEW'],
    REVIEW: ['DRAFT', 'APPROVED'],
    APPROVED: ['REVIEW', 'LOCKED'],
    LOCKED: ['DEPRECATED'],
    DEPRECATED: [],
  };
  if (!allowed[lock.status].includes(target)) {
    throw new Error(`Asset lock transition ${lock.status} -> ${target} is not allowed`);
  }
  if (target === 'LOCKED' && !lock.referenceAssetIds.length) {
    throw new Error('Asset cannot be LOCKED without a canonical reference');
  }
  if (lock.status === 'LOCKED' && target === 'DEPRECATED' && !options.overrideReason?.trim()) {
    throw new Error('Deprecating a locked asset requires an override reason');
  }
  const at = options.at ?? new Date().toISOString();
  return {
    ...structuredClone(lock),
    status: target,
    revision: lock.revision + 1,
    ...(target === 'APPROVED' ? { approvedAt: at } : {}),
    ...(target === 'LOCKED' ? { lockedAt: at } : {}),
    ...(target === 'DEPRECATED' ? { deprecatedAt: at } : {}),
  };
}

export function buildCanonicalBible(story: StoryModel): CanonicalBible {
  const costumes = story.characters.map((character) => {
    const costumeId = `${character.id}-costume-default`;
    return {
      ...record(costumeId, character.assetLock, [character.visual.costume], character.visual.constraints),
      costumeId,
      characterId: character.id,
      description: character.visual.costume,
      validSceneIds: story.scenes.filter((scene) => scene.rolesPresent.includes(character.id)).map((scene) => scene.id),
    };
  });
  const voices = story.characters.map((character) => {
    const voiceId = `${character.id}-voice`;
    return {
      ...record(voiceId, character.assetLock, [character.voice.speakingStyle], []),
      voiceId,
      characterId: character.id,
      ...(character.voice.voiceId ? { providerVoiceId: character.voice.voiceId } : {}),
      ...(character.voice.voiceReferenceAssetId ? { referenceAssetId: character.voice.voiceReferenceAssetId } : {}),
      language: character.voice.language,
      speakingStyle: character.voice.speakingStyle,
      emotionRange: [character.voice.emotion],
    };
  });
  const characters = story.characters.map((character, index) => ({
    ...record(character.id, character.assetLock, [character.visual.appearance], character.visual.constraints),
    characterId: character.id,
    name: character.name,
    face: character.visual.face ?? '',
    hair: character.visual.hair ?? '',
    body: character.visual.body ?? '',
    accessories: [],
    injuryMakeup: [],
    costumeIds: [costumes[index]!.costumeId],
    voiceId: voices[index]!.voiceId,
  }));
  const locations = story.locations.map((location) => ({
    ...record(location.id, location.assetLock, [location.visual], location.constraints ?? []),
    locationId: location.id,
    name: location.name,
    layout: location.description,
    architecture: location.visual,
    materials: [],
    lighting: story.visualBible.lighting ?? '',
    timeOfDay: story.world.timePeriod,
  }));
  const ownerByItem = new Map<EntityId, EntityId>();
  for (const character of story.characters) {
    for (const itemId of character.startingInventoryIds ?? []) {
      if (!ownerByItem.has(itemId)) ownerByItem.set(itemId, character.id);
    }
  }
  const props = [...story.inventory, ...story.evidence].map((item) => ({
    ...record(item.id, undefined, [item.description], []),
    propId: item.id,
    name: item.name,
    description: item.description,
    hero: false,
    ...(ownerByItem.get(item.id) ? { ownerRoleId: ownerByItem.get(item.id)! } : {}),
    state: 'AVAILABLE' as const,
  }));
  const withoutHash = {
    schemaVersion: '1.0.0' as const,
    bibleVersion: story.canonicalBible?.bibleVersion ?? story.storyVersion,
    storyVersion: story.storyVersion,
    projectCanon: {
      title: story.brief.title,
      logline: story.brief.logline,
      genre: [...story.brief.genre],
      playerCount: story.brief.playerCount,
    },
    worldCanon: {
      premise: story.world.premise,
      timePeriod: story.world.timePeriod,
      setting: story.world.setting,
      rules: [...story.world.rules],
    },
    visualCanon: {
      style: story.visualBible.style,
      palette: [...story.visualBible.palette],
      cinematography: story.visualBible.cinematography,
      ...(story.visualBible.lighting ? { lighting: story.visualBible.lighting } : {}),
      aspectRatio: story.visualBible.aspectRatio,
      negativeConstraints: [...(story.visualBible.negativeConstraints ?? [])],
    },
    storyCanon: {
      narrativeKeywords: [...story.narrativeTone.keywords],
      pacing: story.narrativeTone.pacing,
      contentRating: story.narrativeTone.contentRating,
    },
    characters,
    costumes,
    voices,
    locations,
    props,
  };
  return { ...withoutHash, contentHash: hashCanonical(withoutHash as unknown as JsonValue) };
}

export function validateContinuity(story: StoryModel): ContinuityReport {
  const projectedBible = buildCanonicalBible(story);
  const bible = story.canonicalBible ?? projectedBible;
  const issues: ValidationIssue[] = [];
  const characterIds = new Set(story.characters.map((character) => character.id));
  const inventoryIds = new Set(story.inventory.map((item) => item.id));
  const evidenceIds = new Set(story.evidence.map((item) => item.id));
  const sceneIds = new Set(story.scenes.map((scene) => scene.id));
  const relationshipIds = new Set(story.relationships.map((item) => item.id));
  const variableIds = new Set(story.variables.map((item) => item.id));

  if (
    story.canonicalBible &&
    (story.canonicalBible.storyVersion !== story.storyVersion ||
      story.canonicalBible.contentHash !== projectedBible.contentHash)
  ) {
    issues.push(
      issue(
        'CANONICAL_BIBLE_STALE',
        'ERROR',
        story.projectId,
        'Canonical Bible does not match the current StoryVersion.',
      ),
    );
  }

  for (const character of bible.characters) {
    if (character.status === 'LOCKED' && !character.canonicalReferenceAssetIds.length) {
      issues.push(issue('CHARACTER_REFERENCE_MISSING', 'ERROR', character.characterId, 'Locked character has no canonical reference.'));
    }
    for (const [field, value] of [['face', character.face], ['hair', character.hair], ['body', character.body]] as const) {
      if (!value.trim()) issues.push(issue(`CHARACTER_${field.toUpperCase()}_UNSPECIFIED`, 'WARNING', character.characterId, `${field} continuity is unspecified.`));
    }
  }
  for (const voice of bible.voices) {
    if (voice.status === 'LOCKED' && !voice.providerVoiceId && !voice.referenceAssetId) {
      issues.push(issue('VOICE_BINDING_MISSING', 'ERROR', voice.characterId, 'Locked voice has no provider voice or reference asset.'));
    }
  }
  for (const location of bible.locations) {
    if (location.status === 'LOCKED' && !location.canonicalReferenceAssetIds.length) {
      issues.push(issue('LOCATION_REFERENCE_MISSING', 'ERROR', location.locationId, 'Locked location has no canonical reference.'));
    }
  }
  const itemOwners = new Map<EntityId, EntityId[]>();
  for (const character of story.characters) {
    for (const id of character.startingInventoryIds ?? []) {
      if (!inventoryIds.has(id)) issues.push(issue('INVENTORY_REFERENCE_MISSING', 'ERROR', character.id, `Unknown inventory ${id}.`));
      itemOwners.set(id, [...(itemOwners.get(id) ?? []), character.id]);
    }
    for (const id of character.startingEvidenceIds ?? []) {
      if (!evidenceIds.has(id)) issues.push(issue('EVIDENCE_REFERENCE_MISSING', 'ERROR', character.id, `Unknown evidence ${id}.`));
    }
  }
  for (const [id, owners] of itemOwners) {
    const item = story.inventory.find((candidate) => candidate.id === id);
    if (item && !item.transferable && owners.length > 1) {
      issues.push(issue('PROP_OWNERSHIP_CONTRADICTION', 'ERROR', id, `Non-transferable prop starts with ${owners.length} owners.`));
    }
  }
  for (const scene of story.scenes) {
    if (!sceneIds.has(scene.id)) continue;
    const present = new Set(scene.rolesPresent);
    for (const roleId of Object.keys(scene.privateInformationByRole)) {
      if (!present.has(roleId)) issues.push(issue('INFORMATION_LEAK_BOUNDARY', 'ERROR', scene.id, `Private information targets absent role ${roleId}.`));
    }
    for (const roleId of scene.rolesPresent) {
      if (!characterIds.has(roleId)) continue;
      if (!(scene.availableActionsByRole[roleId] ?? []).length) {
        issues.push(issue('MISSING_ROLE_ACTION', 'ERROR', scene.id, `Present role ${roleId} has no action.`));
      }
    }
    const chapter = story.chapters.find((candidate) => candidate.id === scene.chapterId);
    if (!chapter || !chapter.sceneIds.includes(scene.id)) {
      issues.push(issue('TIMELINE_CHAPTER_CONTRADICTION', 'ERROR', scene.id, 'Scene chapterId and chapter sceneIds disagree.'));
    }
    for (const rule of scene.resolutionRules) {
      if (!rule.nextSceneId && !rule.endingId) {
        issues.push(issue('MISSING_RESOLUTION', 'ERROR', rule.id, 'Resolution rule has no next scene or ending.'));
      }
      if (rule.nextSceneId && rule.endingId) {
        issues.push(issue('CONFLICTING_RESOLUTION', 'ERROR', rule.id, 'Resolution rule targets both a scene and an ending.'));
      }
      const writes = new Map<string, string>();
      for (const mutation of rule.mutations) {
        const signature = JSON.stringify([mutation.operation, mutation.value ?? null]);
        const previous = writes.get(mutation.path);
        if (previous && previous !== signature) {
          issues.push(issue('CONFLICTING_STATE_MUTATION', 'ERROR', rule.id, `Rule writes incompatible values to ${mutation.path}.`));
        }
        writes.set(mutation.path, signature);
        validateMutationReference(
          mutation,
          { variableIds, relationshipIds, inventoryIds, evidenceIds },
          rule.id,
          issues,
        );
      }
    }
    if (
      scene.fallbackBehavior.onTimeout === 'DEFAULT_ACTION' &&
      (!scene.fallbackBehavior.defaultActionId ||
        !Object.values(scene.availableActionsByRole)
          .flat()
          .some((action) => action.id === scene.fallbackBehavior.defaultActionId))
    ) {
      issues.push(issue('DEFAULT_ACTION_UNAVAILABLE', 'ERROR', scene.id, 'Timeout default action is not available in the scene.'));
    }
    if (
      scene.fallbackBehavior.onInvalidResolution === 'USE_FALLBACK_SCENE' &&
      (!scene.fallbackBehavior.fallbackSceneId || !sceneIds.has(scene.fallbackBehavior.fallbackSceneId))
    ) {
      issues.push(issue('FALLBACK_SCENE_UNAVAILABLE', 'ERROR', scene.id, 'Invalid-resolution fallback scene does not exist.'));
    }
  }
  for (const character of story.characters) {
    const alive = story.variables.find(
      (variable) =>
        (variable.id === `alive-${character.id}` || variable.id === `${character.id}-alive`) &&
        variable.type === 'BOOLEAN',
    );
    if (alive?.initialValue === false && story.scenes.some((scene) => scene.rolesPresent.includes(character.id))) {
      issues.push(issue('DEAD_CHARACTER_ACTING', 'ERROR', character.id, 'Character starts dead but is present as an acting role.'));
    }
  }
  detectClosedLoops(story, issues);
  const categoryCounts: Record<string, number> = {};
  for (const finding of issues) {
    const category = finding.code.split('_')[0]!;
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  return { valid: !issues.some((finding) => finding.severity === 'ERROR'), bible, issues, categoryCounts };
}

function validateMutationReference(
  mutation: import('@filmgame/shared-types').StateMutation,
  ids: {
    variableIds: Set<EntityId>;
    relationshipIds: Set<EntityId>;
    inventoryIds: Set<EntityId>;
    evidenceIds: Set<EntityId>;
  },
  ruleId: EntityId,
  issues: ValidationIssue[],
): void {
  const [root, owner, target] = mutation.path.split('.');
  if (root === 'variables' && owner && !ids.variableIds.has(owner)) {
    issues.push(issue('VARIABLE_REFERENCE_MISSING', 'ERROR', ruleId, `Mutation references unknown variable ${owner}.`));
  }
  if (root === 'relationships' && owner && !ids.relationshipIds.has(owner)) {
    issues.push(issue('RELATIONSHIP_REFERENCE_MISSING', 'ERROR', ruleId, `Mutation references unknown relationship ${owner}.`));
  }
  if ((mutation.operation === 'GRANT_ITEM' || mutation.operation === 'REVOKE_ITEM') && typeof mutation.value === 'string' && !ids.inventoryIds.has(mutation.value)) {
    issues.push(issue('UNAVAILABLE_PROP_USAGE', 'ERROR', ruleId, `Mutation references unknown prop ${mutation.value}.`));
  }
  if (mutation.operation === 'REVEAL_EVIDENCE' && typeof mutation.value === 'string' && !ids.evidenceIds.has(mutation.value)) {
    issues.push(issue('EVIDENCE_REFERENCE_MISSING', 'ERROR', ruleId, `Mutation references unknown evidence ${mutation.value}.`));
  }
  if (!['variables', 'relationships', 'evidenceByRole', 'inventoryByRole', 'revealedSecrets'].includes(root ?? '')) {
    issues.push(issue('UNSAFE_MUTATION_ROOT', 'ERROR', ruleId, `Mutation root ${root ?? ''} is not authoritative state.`));
  }
  void target;
}

function record(
  id: EntityId,
  lock: AssetLock | undefined,
  positive: string[],
  negative: string[],
): CanonicalBibleRecord {
  const data = { id, positive, negative, revision: lock?.revision ?? 1 };
  return {
    id,
    revision: lock?.revision ?? 1,
    status: lock?.status ?? 'DRAFT',
    canonicalReferenceAssetIds: [...(lock?.referenceAssetIds ?? [])],
    promptConstraints: [...positive, ...(lock?.constraints ?? [])].filter(Boolean),
    negativeConstraints: [...negative].filter(Boolean),
    contentHash: hashCanonical(data as unknown as JsonValue),
  };
}

function hashCanonical(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function issue(code: string, severity: ValidationIssue['severity'], entityId: EntityId, message: string): ValidationIssue {
  return { code, severity, entityId, message };
}

function detectClosedLoops(story: StoryModel, issues: ValidationIssue[]): void {
  const reachableEndingScenes = new Set(
    story.scenes.filter((scene) => scene.resolutionRules.some((rule) => Boolean(rule.endingId))).map((scene) => scene.id),
  );
  for (const scene of story.scenes) {
    if (scene.nextSceneCandidates.includes(scene.id) && !reachableEndingScenes.has(scene.id) && scene.nextSceneCandidates.every((id) => id === scene.id)) {
      issues.push(issue('STORY_INFINITE_LOOP', 'ERROR', scene.id, 'Scene only loops to itself and has no ending rule.'));
    }
  }
}
