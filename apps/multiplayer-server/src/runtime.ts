import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  EntityId,
  JsonValue,
  RuntimeEvent,
  RuntimeGameState,
  StoryModel,
  SubmittedAction,
} from '@filmgame/shared-types';

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
    state: RuntimeGameState;
  }): Promise<SubmittedAction>;
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
