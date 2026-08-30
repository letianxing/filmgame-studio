import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  EntityId,
  JsonValue,
  RuntimeEvent,
  RuntimeGameState,
  StoryModel,
  SubmittedAction,
} from '@filmgame/shared-types';
import { applyStateMutation } from '@filmgame/resolution-engine';

export interface StoryRuntimeDefinition {
  story: StoryModel;
  initialState: RuntimeGameState;
}

export interface RuntimeLoader {
  load(projectId: EntityId, runtimeVersion: number): Promise<StoryRuntimeDefinition>;
}

export interface RuntimeEventStore {
  append(roomId: string, events: RuntimeEvent[]): Promise<void>;
  saveSnapshot(roomId: string, state: RuntimeGameState): Promise<void>;
  loadSnapshot?(roomId: string): Promise<RuntimeGameState | null>;
  loadEvents?(roomId: string): Promise<RuntimeEvent[]>;
}

export interface AuthIdentity {
  userId: string;
  displayName: string;
}

export interface AuthService {
  authenticate(token: string): Promise<AuthIdentity>;
}

export interface BotService {
  chooseAction(input: {
    projectId: EntityId;
    sceneId: EntityId;
    roleId: EntityId;
    availableActionIds: EntityId[];
    knowledge: RoleKnowledgeView;
  }): Promise<SubmittedAction>;
}

export interface RoleKnowledgeView {
  roleId: EntityId;
  sceneId: EntityId;
  publicInformation: string[];
  privateInformation: string[];
  ownSecrets: string[];
  goals: string[];
  victoryConditions: string[];
  evidenceIds: EntityId[];
  inventoryIds: EntityId[];
  availableActionIds: EntityId[];
}

export function createRoleKnowledgeView(
  story: StoryModel,
  state: RuntimeGameState,
  roleId: EntityId,
): RoleKnowledgeView {
  const character = story.characters.find((candidate) => candidate.id === roleId);
  if (!character) throw new Error(`Unknown role ${roleId}`);
  const scene = story.scenes.find((candidate) => candidate.id === state.sceneId);
  if (!scene) throw new Error(`Unknown scene ${state.sceneId}`);
  return {
    roleId,
    sceneId: scene.id,
    publicInformation: [...scene.publicInformation],
    privateInformation: [...(scene.privateInformationByRole[roleId] ?? [])],
    ownSecrets: character.secrets.map((secret) => secret.summary),
    goals: character.goals.map((goal) => goal.description),
    victoryConditions: character.victoryConditions.map((condition) => condition.description),
    evidenceIds: [...(state.evidenceByRole[roleId] ?? [])],
    inventoryIds: [...(state.inventoryByRole[roleId] ?? [])],
    availableActionIds: (scene.availableActionsByRole[roleId] ?? []).map((action) => action.id),
  };
}

export interface StoryRoomDependencies {
  runtimeLoader: RuntimeLoader;
  eventStore: RuntimeEventStore;
  authService: AuthService;
  botService: BotService;
}

export class FileRuntimeLoader implements RuntimeLoader {
  constructor(readonly storyFile: URL) {}

  async load(projectId: EntityId, runtimeVersion: number): Promise<StoryRuntimeDefinition> {
    if (runtimeVersion < 1) throw new Error('runtimeVersion must be positive');
    const story = JSON.parse(await readFile(this.storyFile, 'utf8')) as StoryModel;
    if (story.projectId !== projectId) {
      throw new Error(`Runtime package ${projectId}@${runtimeVersion} was not found`);
    }
    return { story, initialState: createInitialState(story) };
  }
}

export class DirectoryRuntimeLoader implements RuntimeLoader {
  readonly #root: string;

  constructor(rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new Error('Runtime definition root must be absolute');
    this.#root = path.resolve(rootDirectory);
  }

  async load(projectId: EntityId, runtimeVersion: number): Promise<StoryRuntimeDefinition> {
    if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u.test(projectId)) {
      throw new Error('Invalid runtime project id');
    }
    if (!Number.isInteger(runtimeVersion) || runtimeVersion < 1) {
      throw new Error('runtimeVersion must be positive');
    }
    const filename = path.resolve(this.#root, projectId, `runtime-v${runtimeVersion}`, 'story.json');
    if (!filename.startsWith(`${this.#root}${path.sep}`)) throw new Error('Runtime path escaped root');
    const story = JSON.parse(await readFile(filename, 'utf8')) as StoryModel;
    if (story.projectId !== projectId) {
      throw new Error(`Runtime definition identity mismatch for ${projectId}@${runtimeVersion}`);
    }
    return { story, initialState: createInitialState(story) };
  }
}

export class InMemoryRuntimeEventStore implements RuntimeEventStore {
  readonly events = new Map<string, RuntimeEvent[]>();
  readonly snapshots = new Map<string, RuntimeGameState>();

  async append(roomId: string, events: RuntimeEvent[]): Promise<void> {
    const existing = this.events.get(roomId) ?? [];
    existing.push(...structuredClone(events));
    this.events.set(roomId, existing);
  }

  async saveSnapshot(roomId: string, state: RuntimeGameState): Promise<void> {
    this.snapshots.set(roomId, structuredClone(state));
  }

  async loadSnapshot(roomId: string): Promise<RuntimeGameState | null> {
    const value = this.snapshots.get(roomId);
    return value ? structuredClone(value) : null;
  }

  async loadEvents(roomId: string): Promise<RuntimeEvent[]> {
    return structuredClone(this.events.get(roomId) ?? []);
  }
}

export class FileRuntimeEventStore implements RuntimeEventStore {
  readonly #root: string;
  readonly #pending = new Map<string, Promise<void>>();

  constructor(rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new Error('Runtime event root must be absolute');
    this.#root = path.resolve(rootDirectory);
  }

  append(roomId: string, events: RuntimeEvent[]): Promise<void> {
    validateRoomId(roomId);
    const next = (this.#pending.get(roomId) ?? Promise.resolve()).then(async () => {
      const directory = this.#roomDirectory(roomId);
      await mkdir(directory, { recursive: true });
      await appendFile(
        path.join(directory, 'events.jsonl'),
        events.map((event) => `${JSON.stringify(event)}\n`).join(''),
        'utf8',
      );
    });
    this.#pending.set(roomId, next);
    return next.finally(() => {
      if (this.#pending.get(roomId) === next) this.#pending.delete(roomId);
    });
  }

  async saveSnapshot(roomId: string, state: RuntimeGameState): Promise<void> {
    validateRoomId(roomId);
    const directory = this.#roomDirectory(roomId);
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, 'snapshot.json');
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  }

  async loadSnapshot(roomId: string): Promise<RuntimeGameState | null> {
    validateRoomId(roomId);
    try {
      return JSON.parse(await readFile(path.join(this.#roomDirectory(roomId), 'snapshot.json'), 'utf8')) as RuntimeGameState;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }

  async loadEvents(roomId: string): Promise<RuntimeEvent[]> {
    validateRoomId(roomId);
    try {
      const lines = (await readFile(path.join(this.#roomDirectory(roomId), 'events.jsonl'), 'utf8'))
        .split(/\r?\n/u)
        .filter(Boolean);
      return lines.map((line) => JSON.parse(line) as RuntimeEvent);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }

  #roomDirectory(roomId: string): string {
    const directory = path.resolve(this.#root, roomId);
    if (!directory.startsWith(`${this.#root}${path.sep}`)) throw new Error('Room path escaped root');
    return directory;
  }
}

export class DevelopmentAuthService implements AuthService {
  async authenticate(token: string): Promise<AuthIdentity> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DevelopmentAuthService is forbidden in production');
    }
    if (!token || token.length > 256) throw new Error('Invalid development token');
    return { userId: `dev-${token}`, displayName: token };
  }
}

export class DeterministicBotService implements BotService {
  async chooseAction(input: {
    roleId: EntityId;
    availableActionIds: EntityId[];
  }): Promise<SubmittedAction> {
    const actionId = input.availableActionIds[0];
    if (!actionId) throw new Error(`Bot role ${input.roleId} has no available action`);
    return {
      roleId: input.roleId,
      actionId,
      submittedAt: new Date().toISOString(),
    };
  }
}

export function createInitialState(story: StoryModel): RuntimeGameState {
  const firstChapter = [...story.chapters].sort((left, right) => left.order - right.order)[0];
  const sceneId = firstChapter?.sceneIds[0];
  if (!sceneId) throw new Error('Story has no initial scene');
  const evidenceByRole: Record<EntityId, EntityId[]> = {};
  const inventoryByRole: Record<EntityId, EntityId[]> = {};
  for (const character of story.characters) {
    evidenceByRole[character.id] = [...(character.startingEvidenceIds ?? [])];
    inventoryByRole[character.id] = [...(character.startingInventoryIds ?? [])];
  }

  return {
    sceneId,
    phase: 'LOBBY',
    variables: Object.fromEntries(
      story.variables.map((variable) => [variable.id, structuredClone(variable.initialValue)]),
    ) as Record<string, JsonValue>,
    relationships: Object.fromEntries(
      story.relationships.map((relationship) => [relationship.id, relationship.initialTrust]),
    ),
    evidenceByRole,
    inventoryByRole,
    revealedSecrets: [],
    historySequence: 0,
    submittedActions: {},
  };
}

export function hashRuntimeState(state: RuntimeGameState): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        sceneId: state.sceneId,
        phase: state.phase,
        variables: state.variables,
        relationships: state.relationships,
        evidenceByRole: state.evidenceByRole,
        inventoryByRole: state.inventoryByRole,
        revealedSecrets: state.revealedSecrets,
        endingId: state.endingId ?? null,
      }),
    )
    .digest('hex');
}

export function replayRuntimeEvents(
  initialState: RuntimeGameState,
  events: RuntimeEvent[],
): RuntimeGameState {
  let state = structuredClone(initialState);
  let expectedSequence = state.historySequence + 1;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.sequence !== expectedSequence) {
      throw new Error(`Runtime event sequence gap: expected ${expectedSequence}, got ${event.sequence}`);
    }
    const before = hashRuntimeState(state);
    if (event.stateBeforeHash && event.stateBeforeHash !== before) {
      throw new Error(`Runtime replay before-hash mismatch at sequence ${event.sequence}`);
    }
    state = applyRuntimeEvent(state, event);
    state.historySequence = event.sequence;
    const after = hashRuntimeState(state);
    if (event.stateAfterHash && event.stateAfterHash !== after) {
      throw new Error(`Runtime replay after-hash mismatch at sequence ${event.sequence}`);
    }
    expectedSequence += 1;
  }
  return state;
}

function applyRuntimeEvent(state: RuntimeGameState, event: RuntimeEvent): RuntimeGameState {
  if (event.type === 'PHASE_CHANGED') {
    const phase = event.payload.phase;
    if (!['LOBBY', 'BRIEFING', 'PLAYING', 'RESOLVING', 'ENDING', 'PAUSED'].includes(String(phase))) {
      throw new Error('Invalid PHASE_CHANGED event');
    }
    return { ...structuredClone(state), phase: phase as RuntimeGameState['phase'] };
  }
  if (event.type === 'STATE_MUTATED') {
    const operation = event.payload.operation;
    const mutationPath = event.payload.path;
    if (typeof operation !== 'string' || typeof mutationPath !== 'string') {
      throw new Error('Invalid STATE_MUTATED event');
    }
    return applyStateMutation(state, {
      operation: operation as import('@filmgame/shared-types').MutationOperation,
      path: mutationPath,
      ...(event.payload.value === undefined ? {} : { value: event.payload.value }),
    });
  }
  if (event.type === 'SCENE_CHANGED') {
    const sceneId = event.payload.sceneId;
    if (typeof sceneId !== 'string') throw new Error('Invalid SCENE_CHANGED event');
    const next = { ...structuredClone(state), sceneId, phase: 'PLAYING' as const, submittedActions: {} };
    delete next.endingId;
    return next;
  }
  if (event.type === 'ENDING_REACHED') {
    const endingId = event.payload.endingId;
    if (typeof endingId !== 'string') throw new Error('Invalid ENDING_REACHED event');
    return { ...structuredClone(state), endingId, phase: 'ENDING', submittedActions: {} };
  }
  return structuredClone(state);
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateRoomId(roomId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/u.test(roomId)) throw new Error('Invalid room id');
}
