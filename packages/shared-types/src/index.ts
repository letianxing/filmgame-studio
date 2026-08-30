export type EntityId = string;
export type ISODateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ComparisonOperator =
  | 'EQ'
  | 'NE'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'IN'
  | 'CONTAINS'
  | 'EXISTS';

export type Predicate = {
  path: string;
  operator: ComparisonOperator;
  value?: JsonValue;
};

export type Condition =
  | Predicate
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type MutationOperation =
  | 'SET'
  | 'INCREMENT'
  | 'DECREMENT'
  | 'ADD_TO_SET'
  | 'REMOVE_FROM_SET'
  | 'GRANT_ITEM'
  | 'REVOKE_ITEM'
  | 'REVEAL_EVIDENCE'
  | 'SET_RELATIONSHIP';

export interface StateMutation {
  operation: MutationOperation;
  path: string;
  value?: JsonValue;
  reason?: string;
}

export interface ProjectBrief {
  title: string;
  logline: string;
  genre: string[];
  playerCount: number;
  targetDurationMinutes: number;
  interactionStyle: string[];
  endingTarget: number;
  budgetTier?: 'PROTOTYPE' | 'INDIE' | 'STANDARD' | 'PREMIUM';
  specialRequirements?: string[];
}

export interface AssetLock {
  status: 'DRAFT' | 'APPROVED' | 'LOCKED';
  revision: number;
  referenceAssetIds: EntityId[];
  constraints: string[];
  lockedAt?: ISODateTime;
}

export interface Character {
  id: EntityId;
  name: string;
  pronouns?: string;
  publicProfile: { role: string; summary: string; traits?: string[] };
  secrets: Array<{
    id: EntityId;
    summary: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    revealCondition?: Condition;
  }>;
  goals: Array<{ id: EntityId; description: string; priority: number; private?: boolean }>;
  victoryConditions: Array<{
    id: EntityId;
    description: string;
    condition: Condition;
    score: number;
  }>;
  startingEvidenceIds?: EntityId[];
  startingInventoryIds?: EntityId[];
  visual: {
    appearance: string;
    face?: string;
    hair?: string;
    body?: string;
    costume: string;
    promptTemplate?: string;
    constraints: string[];
  };
  voice: {
    voiceId?: string | null;
    voiceReferenceAssetId?: string | null;
    language: string;
    speakingStyle: string;
    emotion: string;
    speed: number;
  };
  assetLock?: AssetLock;
}

export interface Relationship {
  id: EntityId;
  fromCharacterId: EntityId;
  toCharacterId: EntityId;
  publicLabel: string;
  privateTruth: string;
  initialTrust: number;
  tags?: string[];
}

export interface Location {
  id: EntityId;
  name: string;
  description: string;
  visual: string;
  constraints?: string[];
  assetLock: AssetLock;
}

export interface VariableDefinition {
  id: EntityId;
  type: 'BOOLEAN' | 'INTEGER' | 'NUMBER' | 'STRING' | 'STRING_SET';
  initialValue: JsonValue;
  visibility: 'PUBLIC' | 'SERVER_ONLY' | 'ROLE_PRIVATE';
  ownerRoleId?: EntityId;
  minimum?: number;
  maximum?: number;
}

export interface RoleAction {
  id: EntityId;
  label: string;
  description?: string;
  intentType: string;
  inputMode: 'NONE' | 'TARGET_ROLE' | 'TARGET_EVIDENCE' | 'TARGET_ITEM' | 'FREE_TEXT';
  visibleWhen?: Condition;
  enabledWhen?: Condition;
  oncePerScene?: boolean;
}

export interface ResolutionRule {
  id: EntityId;
  priority: number;
  when: Condition;
  mutations: StateMutation[];
  nextSceneId?: EntityId;
  endingId?: EntityId;
  explanation?: string;
}

export interface StoryScene {
  id: EntityId;
  chapterId: EntityId;
  title: string;
  summary?: string;
  locationId: EntityId;
  rolesPresent: EntityId[];
  publicInformation: string[];
  privateInformationByRole: Record<EntityId, string[]>;
  availableActionsByRole: Record<EntityId, RoleAction[]>;
  resolutionRules: ResolutionRule[];
  stateMutationsOnEnter?: StateMutation[];
  nextSceneCandidates: EntityId[];
  timing: {
    decisionSeconds: number;
    discussionSeconds: number;
    videoDurationSeconds?: number;
  };
  fallbackBehavior: {
    onTimeout: 'ABSTAIN' | 'AI_BOT' | 'DEFAULT_ACTION';
    defaultActionId?: EntityId;
    onInvalidResolution: 'RETRY' | 'USE_FALLBACK_SCENE' | 'PAUSE_ROOM';
    fallbackSceneId?: EntityId;
  };
  script?: string;
  videoAssetId?: EntityId;
}

export interface Ending {
  id: EntityId;
  title: string;
  summary: string;
  condition: Condition;
  priority: number;
  hidden?: boolean;
  characterResults: Record<EntityId, string>;
  videoAssetId?: EntityId;
}

export interface StoryModel {
  schemaVersion: '1.0.0';
  projectId: EntityId;
  storyVersion: number;
  parentStoryVersion?: number | null;
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LOCKED' | 'ARCHIVED';
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
  brief: ProjectBrief;
  world: {
    premise: string;
    timePeriod: string;
    setting: string;
    history?: string[];
    rules: string[];
    factions?: string[];
  };
  narrativeTone: {
    keywords: string[];
    pacing: string;
    contentRating: string;
    avoid?: string[];
    dialogueGuidance?: string;
  };
  visualBible: {
    style: string;
    palette: string[];
    cinematography: string;
    lighting?: string;
    aspectRatio: string;
    negativeConstraints?: string[];
  };
  characters: Character[];
  relationships: Relationship[];
  locations: Location[];
  variables: VariableDefinition[];
  inventory: Array<{ id: EntityId; name: string; description: string; transferable: boolean; consumable?: boolean }>;
  evidence: Array<{
    id: EntityId;
    name: string;
    description: string;
    authenticity: 'AUTHENTIC' | 'FORGED' | 'AMBIGUOUS';
    sourceSceneId?: EntityId;
    contradictsEvidenceIds?: EntityId[];
  }>;
  chapters: Array<{
    id: EntityId;
    title: string;
    order: number;
    targetDurationMinutes: number;
    sceneIds: EntityId[];
  }>;
  scenes: StoryScene[];
  endings: Ending[];
  validation?: ValidationSummary;
  metadata?: Record<string, JsonValue>;
}

export interface ValidationIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  entityId?: EntityId;
  path?: string;
}

export interface ValidationSummary {
  validatedAt: ISODateTime;
  valid: boolean;
  issues: ValidationIssue[];
  reachableEndingIds?: EntityId[];
  participationScoreByRole?: Record<EntityId, number>;
}

export interface RuntimeGameState {
  sceneId: EntityId;
  phase: 'LOBBY' | 'BRIEFING' | 'PLAYING' | 'RESOLVING' | 'ENDING' | 'PAUSED';
  variables: Record<string, JsonValue>;
  relationships: Record<string, number>;
  evidenceByRole: Record<EntityId, EntityId[]>;
  inventoryByRole: Record<EntityId, EntityId[]>;
  revealedSecrets: EntityId[];
  historySequence: number;
  endingId?: EntityId;
  submittedActions?: Record<EntityId, SubmittedAction>;
}

export interface SubmittedAction {
  actionId: EntityId;
  roleId: EntityId;
  targetId?: EntityId;
  text?: string;
  submittedAt: ISODateTime;
}

export interface RuntimeEvent {
  sequence: number;
  eventId: string;
  roomId: string;
  occurredAt: ISODateTime;
  type: string;
  actorRoleId?: EntityId;
  payload: Record<string, JsonValue>;
  stateHash?: string;
}

export type ProductionJobType =
  | 'DIRECTOR_BREAKDOWN'
  | 'STORYBOARD'
  | 'IMAGE'
  | 'VIDEO'
  | 'TTS'
  | 'SUBTITLE'
  | 'MUSIC'
  | 'SFX'
  | 'MEDIA_RENDER'
  | 'QA'
  | 'PACKAGE';

export type JobStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

export interface ProductionJob {
  id: EntityId;
  type: ProductionJobType;
  entityId?: EntityId;
  status: JobStatus;
  dependencies: EntityId[];
  attempt: number;
  maxAttempts: number;
  input?: Record<string, JsonValue>;
  output?: Record<string, JsonValue>;
  error?: string;
}

