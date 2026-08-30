import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  CloseCode,
  Room,
  type Client,
  type AuthContext,
  validate,
} from 'colyseus';
import { z } from 'zod';

import {
  applyStateMutation,
  evaluateCondition,
  resolveScene,
} from '@filmgame/resolution-engine';
import type {
  EntityId,
  JsonValue,
  RuntimeEvent,
  RuntimeGameState,
  StoryScene,
  SubmittedAction,
} from '@filmgame/shared-types';

import type { AuthIdentity, StoryRoomDependencies, StoryRuntimeDefinition } from './runtime.js';
import { createRoleKnowledgeView, hashRuntimeState } from './runtime.js';

export const PlayerPresence = schema({
  sessionId: t.string(),
  roleId: t.string(),
  displayName: t.string(),
  connected: t.boolean(),
  ready: t.boolean(),
  isBot: t.boolean(),
});
export type PlayerPresence = SchemaType<typeof PlayerPresence>;

export const StoryRoomState = schema({
  projectId: t.string(),
  runtimeVersion: t.number(),
  phase: t.string(),
  sceneId: t.string(),
  sequence: t.number(),
  timerEndsAt: t.string(),
  endingId: t.string(),
  hostSessionId: t.string(),
  players: t.map(PlayerPresence),
});
export type StoryRoomState = SchemaType<typeof StoryRoomState>;

interface PlayerSession {
  roleId: EntityId;
  userId: string;
}

type StoryClient = Client<{
  auth: AuthIdentity;
  userData: PlayerSession;
  messages: {
    privateState: unknown;
    actionAccepted: { actionId: string };
    runtimeEvents: unknown[];
    error: { code: string; message: string };
  };
}>;

interface CreateOptions {
  projectId: EntityId;
  runtimeVersion: number;
  aiBotRoleIds?: EntityId[];
  resumeRoomId?: string;
}

interface JoinOptions {
  authToken: string;
  requestedRoleId?: EntityId;
}

const readyMessage = z.object({ ready: z.boolean().default(true) });
const actionMessage = z.object({
  actionId: z.string().min(2).max(96),
  targetId: z.string().min(2).max(96).optional(),
  text: z.string().max(2_000).optional(),
});

export class StoryRoom extends Room<{ state: StoryRoomState; client: StoryClient }> {
  static #dependencies: StoryRoomDependencies | undefined;

  static configure(dependencies: StoryRoomDependencies): void {
    this.#dependencies = dependencies;
  }

  state = new StoryRoomState();
  #runtime!: StoryRuntimeDefinition;
  #gameState!: RuntimeGameState;
  #submittedActions = new Map<EntityId, SubmittedAction>();
  #roleBySession = new Map<string, EntityId>();
  #sceneTimer?: ReturnType<StoryRoom['clock']['setTimeout']>;

  messages = {
    ready: validate(readyMessage, (client: StoryClient, message) => {
      this.#setReady(client, message.ready);
    }),
    submitAction: validate(actionMessage, (client: StoryClient, message) => {
      void this.#submitAction(client, message);
    }),
    requestPrivateState: (client: StoryClient) => {
      this.#sendPrivateState(client);
    },
    startWithBots: (client: StoryClient) => {
      if (client.sessionId !== this.state.hostSessionId) {
        client.send('error', {
          code: 'HOST_PERMISSION_REQUIRED',
          message: 'Only the current host can fill open roles with bots.',
        });
        return;
      }
      void this.#fillOpenRolesWithBots();
    },
  };

  async onAuth(
    _client: StoryClient,
    options: JoinOptions,
    _context: AuthContext,
  ): Promise<AuthIdentity> {
    return StoryRoom.dependencies.authService.authenticate(options.authToken);
  }

  async onCreate(options: CreateOptions): Promise<void> {
    this.#runtime = await StoryRoom.dependencies.runtimeLoader.load(
      options.projectId,
      options.runtimeVersion,
    );
    this.#gameState = structuredClone(this.#runtime.initialState);
    if (options.resumeRoomId && StoryRoom.dependencies.eventStore.loadSnapshot) {
      const recovered = await StoryRoom.dependencies.eventStore.loadSnapshot(options.resumeRoomId);
      if (recovered) this.#gameState = recovered;
    }
    this.maxClients = this.#runtime.story.characters.length;
    this.state.projectId = options.projectId;
    this.state.runtimeVersion = options.runtimeVersion;
    this.state.phase = this.#gameState.phase;
    this.state.sceneId = this.#gameState.sceneId;
    this.state.sequence = 0;
    this.state.timerEndsAt = '';
    this.state.endingId = '';
    this.state.hostSessionId = '';
    await this.setMetadata({
      projectId: options.projectId,
      runtimeVersion: options.runtimeVersion,
      ...(options.resumeRoomId ? { resumedFromRoomId: options.resumeRoomId } : {}),
    });

    for (const roleId of options.aiBotRoleIds ?? []) {
      this.#addBot(roleId);
    }
  }

  onJoin(client: StoryClient, options: JoinOptions): void {
    const auth = client.auth;
    if (!auth) throw new Error('Authenticated identity is missing');
    const roleId = this.#assignRole(options.requestedRoleId);
    client.userData = { roleId, userId: auth.userId };
    this.#roleBySession.set(client.sessionId, roleId);
    const presence = new PlayerPresence();
    presence.sessionId = client.sessionId;
    presence.roleId = roleId;
    presence.displayName = auth.displayName;
    presence.connected = true;
    presence.ready = false;
    presence.isBot = false;
    this.state.players.set(client.sessionId, presence);
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    void this.#record('PLAYER_JOINED', roleId, { sessionId: client.sessionId });
  }

  async onLeave(client: StoryClient, code: number): Promise<void> {
    const presence = this.state.players.get(client.sessionId);
    if (!presence) return;
    presence.connected = false;
    await this.#record('PLAYER_DISCONNECTED', presence.roleId, { code });

    try {
      if (code === CloseCode.CONSENTED) throw new Error('Player left intentionally');
      const reconnected = (await this.allowReconnection(client, 30)) as StoryClient;
      const restored = this.state.players.get(reconnected.sessionId);
      if (restored) restored.connected = true;
      this.#sendPrivateState(reconnected);
      await this.#record('PLAYER_RECONNECTED', presence.roleId, {});
    } catch {
      presence.isBot = true;
      presence.connected = true;
      presence.displayName = `${presence.displayName} · AI 补位`;
      this.#electHost(client.sessionId);
      await this.#record('BOT_TAKEOVER', presence.roleId, {});
      if (this.state.phase === 'PLAYING') await this.#submitBotAction(presence.roleId);
    }
  }

  async onDispose(): Promise<void> {
    this.#sceneTimer?.clear();
    await StoryRoom.dependencies.eventStore.saveSnapshot(this.roomId, this.#gameState);
  }

  #setReady(client: StoryClient, ready: boolean): void {
    const presence = this.state.players.get(client.sessionId);
    if (!presence) return;
    presence.ready = ready;
    void this.#record('PLAYER_READY_CHANGED', presence.roleId, { ready });
    if (this.#allRolesSeatedAndReady()) void this.#startGame();
  }

  async #startGame(): Promise<void> {
    if (this.state.phase !== 'LOBBY') return;
    const stateBeforeHash = hashRuntimeState(this.#gameState);
    this.#gameState.phase = 'PLAYING';
    this.#gameState.historySequence += 1;
    await StoryRoom.dependencies.eventStore.append(this.roomId, [
      {
        sequence: this.#gameState.historySequence,
        eventId: crypto.randomUUID(),
        roomId: this.roomId,
        occurredAt: new Date().toISOString(),
        type: 'PHASE_CHANGED',
        sceneId: this.#gameState.sceneId,
        payload: { phase: 'PLAYING' },
        stateBeforeHash,
        stateAfterHash: hashRuntimeState(this.#gameState),
      },
    ]);
    await this.#recordSceneEntryMutations();
    this.#syncPublicState();
    await this.#record('GAME_STARTED', undefined, { sceneId: this.#gameState.sceneId });
    await StoryRoom.dependencies.eventStore.saveSnapshot(this.roomId, this.#gameState);
    this.#sendPrivateStateToAll();
    this.#startSceneTimer();
  }

  async #submitAction(
    client: StoryClient,
    message: { actionId: string; targetId?: string | undefined; text?: string | undefined },
  ): Promise<void> {
    if (this.state.phase !== 'PLAYING') {
      client.send('error', { code: 'SCENE_NOT_ACCEPTING_ACTIONS', message: '当前阶段不能提交动作' });
      return;
    }
    const roleId = client.userData?.roleId;
    if (!roleId) throw new Error('Player session is missing a role');
    const scene = this.#currentScene();
    const action = scene.availableActionsByRole[roleId]?.find(
      (candidate) => candidate.id === message.actionId,
    );
    if (!action) {
      client.send('error', { code: 'ACTION_NOT_AUTHORIZED', message: '该角色不能执行此动作' });
      return;
    }
    if (action.enabledWhen && !evaluateCondition(action.enabledWhen, this.#gameState)) {
      client.send('error', { code: 'ACTION_NOT_ENABLED', message: '动作条件尚未满足' });
      return;
    }
    const submitted: SubmittedAction = {
      roleId,
      actionId: action.id,
      submittedAt: new Date().toISOString(),
      ...(message.targetId ? { targetId: message.targetId } : {}),
      ...(message.text ? { text: message.text } : {}),
    };
    this.#submittedActions.set(roleId, submitted);
    client.send('actionAccepted', { actionId: action.id });
    await this.#record('ACTION_SUBMITTED', roleId, { actionId: action.id });
    await this.#submitIdleBotActions();
    if (this.#allSceneRolesSubmitted()) await this.#resolve();
  }

  async #resolve(): Promise<void> {
    if (this.state.phase !== 'PLAYING') return;
    this.#sceneTimer?.clear();
    const stateBefore = structuredClone(this.#gameState);
    const baseSequence = stateBefore.historySequence;
    const result = resolveScene({
      roomId: this.roomId,
      scene: this.#currentScene(),
      state: this.#gameState,
      actions: [...this.#submittedActions.values()],
      now: new Date().toISOString(),
    });
    let replayState = structuredClone(stateBefore);
    this.#submittedActions.clear();
    const events: RuntimeEvent[] = result.events.map((event, index) => {
      const stateBeforeHash = hashRuntimeState(replayState);
      replayState = applyResolutionEventForReplay(replayState, event);
      const stateAfterHash = hashRuntimeState(replayState);
      return {
        sequence: baseSequence + index + 1,
        eventId: crypto.randomUUID(),
        roomId: this.roomId,
        occurredAt: new Date().toISOString(),
        type: event.type,
        sceneId: stateBefore.sceneId,
        ...(event.actorRoleId ? { actorRoleId: event.actorRoleId } : {}),
        ...(event.type === 'ACTION_ACCEPTED' && typeof event.payload.actionId === 'string'
          ? { action: event.payload.actionId }
          : {}),
        payload: event.payload,
        stateBeforeHash,
        stateAfterHash,
        resolutionRuleId: result.matchedRuleId,
      };
    });
    if (hashRuntimeState(replayState) !== hashRuntimeState(result.state)) {
      throw new Error(`Resolution event replay diverged for scene ${stateBefore.sceneId}`);
    }
    if (replayState.phase === 'PLAYING') {
      for (const mutation of this.#currentSceneForState(replayState).stateMutationsOnEnter ?? []) {
        const stateBeforeHash = hashRuntimeState(replayState);
        replayState = applyStateMutation(replayState, mutation);
        events.push({
          sequence: baseSequence + events.length + 1,
          eventId: crypto.randomUUID(),
          roomId: this.roomId,
          occurredAt: new Date().toISOString(),
          type: 'STATE_MUTATED',
          sceneId: replayState.sceneId,
          payload: {
            operation: mutation.operation,
            path: mutation.path,
            ...(mutation.value === undefined ? {} : { value: mutation.value }),
            source: 'SCENE_ENTRY',
          },
          stateBeforeHash,
          stateAfterHash: hashRuntimeState(replayState),
          resolutionRuleId: result.matchedRuleId,
        });
      }
    }
    replayState.historySequence = baseSequence + events.length;
    replayState.submittedActions = {};
    this.#gameState = replayState;
    this.#syncPublicState();
    await StoryRoom.dependencies.eventStore.append(this.roomId, events);
    await StoryRoom.dependencies.eventStore.saveSnapshot(this.roomId, this.#gameState);
    this.broadcast('runtimeEvents', events.map(publicRuntimeEvent));
    this.#sendPrivateStateToAll();
    if (this.#gameState.phase === 'PLAYING') this.#startSceneTimer();
  }

  #startSceneTimer(): void {
    this.#sceneTimer?.clear();
    const scene = this.#currentScene();
    const timeoutMs = (scene.timing.discussionSeconds + scene.timing.decisionSeconds) * 1_000;
    this.state.timerEndsAt = new Date(Date.now() + timeoutMs).toISOString();
    this.#sceneTimer = this.clock.setTimeout(() => void this.#resolveTimeout(), timeoutMs);
  }

  async #resolveTimeout(): Promise<void> {
    const scene = this.#currentScene();
    for (const roleId of scene.rolesPresent) {
      if (!this.#submittedActions.has(roleId)) await this.#submitBotAction(roleId);
    }
    if (this.state.phase === 'PLAYING') await this.#resolve();
  }

  async #submitBotAction(roleId: EntityId): Promise<void> {
    if (this.#submittedActions.has(roleId) || this.state.phase !== 'PLAYING') return;
    const scene = this.#currentScene();
    const availableActionIds = (scene.availableActionsByRole[roleId] ?? []).map((action) => action.id);
    const action = await StoryRoom.dependencies.botService.chooseAction({
      projectId: this.state.projectId,
      sceneId: scene.id,
      roleId,
      availableActionIds,
      knowledge: createRoleKnowledgeView(this.#runtime.story, this.#gameState, roleId),
    });
    this.#submittedActions.set(roleId, action);
    await this.#record('BOT_ACTION_SUBMITTED', roleId, { actionId: action.actionId });
  }

  async #submitIdleBotActions(): Promise<void> {
    const botRoles = [...this.state.players.values()]
      .filter((player) => player.isBot)
      .map((player) => player.roleId);
    for (const roleId of botRoles) await this.#submitBotAction(roleId);
  }

  async #fillOpenRolesWithBots(): Promise<void> {
    const caller = [...this.clients].find((client) => client.sessionId === this.state.hostSessionId);
    if (!caller) return;
    const occupied = new Set([...this.state.players.values()].map((player) => player.roleId));
    for (const character of this.#runtime.story.characters) {
      if (!occupied.has(character.id)) this.#addBot(character.id);
    }
    if (this.#allRolesSeatedAndReady()) await this.#startGame();
  }

  #addBot(roleId: EntityId): void {
    if (!this.#runtime.story.characters.some((character) => character.id === roleId)) {
      throw new Error(`Unknown bot role ${roleId}`);
    }
    if ([...this.state.players.values()].some((player) => player.roleId === roleId)) return;
    const key = `bot-${roleId}`;
    const presence = new PlayerPresence();
    presence.sessionId = key;
    presence.roleId = roleId;
    presence.displayName = `${this.#character(roleId).name} · AI`;
    presence.connected = true;
    presence.ready = true;
    presence.isBot = true;
    this.state.players.set(key, presence);
  }

  #assignRole(requestedRoleId?: EntityId): EntityId {
    const occupied = new Set([...this.state.players.values()].map((player) => player.roleId));
    if (requestedRoleId && !occupied.has(requestedRoleId) && this.#characterOrNull(requestedRoleId)) {
      return requestedRoleId;
    }
    const available = this.#runtime.story.characters.find((character) => !occupied.has(character.id));
    if (!available) throw new Error('No role is available');
    return available.id;
  }

  #allRolesSeatedAndReady(): boolean {
    const players = [...this.state.players.values()];
    return players.length === this.#runtime.story.characters.length && players.every((player) => player.ready);
  }

  #allSceneRolesSubmitted(): boolean {
    return this.#currentScene().rolesPresent.every((roleId) => this.#submittedActions.has(roleId));
  }

  async #recordSceneEntryMutations(): Promise<void> {
    const events: RuntimeEvent[] = [];
    for (const mutation of this.#currentScene().stateMutationsOnEnter ?? []) {
      const stateBeforeHash = hashRuntimeState(this.#gameState);
      this.#gameState = applyStateMutation(this.#gameState, mutation);
      this.#gameState.historySequence += 1;
      events.push({
        sequence: this.#gameState.historySequence,
        eventId: crypto.randomUUID(),
        roomId: this.roomId,
        occurredAt: new Date().toISOString(),
        type: 'STATE_MUTATED',
        sceneId: this.#gameState.sceneId,
        payload: {
          operation: mutation.operation,
          path: mutation.path,
          ...(mutation.value === undefined ? {} : { value: mutation.value }),
          source: 'SCENE_ENTRY',
        },
        stateBeforeHash,
        stateAfterHash: hashRuntimeState(this.#gameState),
      });
    }
    if (events.length) await StoryRoom.dependencies.eventStore.append(this.roomId, events);
  }

  #syncPublicState(): void {
    this.state.phase = this.#gameState.phase;
    this.state.sceneId = this.#gameState.sceneId;
    this.state.sequence = this.#gameState.historySequence;
    this.state.endingId = this.#gameState.endingId ?? '';
  }

  #sendPrivateStateToAll(): void {
    for (const client of this.clients) this.#sendPrivateState(client as StoryClient);
  }

  #sendPrivateState(client: StoryClient): void {
    const roleId = client.userData?.roleId;
    if (!roleId) return;
    const character = this.#character(roleId);
    const scene = this.#currentScene();
    client.send('privateState', {
      roleId,
      identity: character.name,
      publicProfile: character.publicProfile,
      secrets: character.secrets,
      goals: character.goals,
      victoryConditions: character.victoryConditions,
      evidenceIds: this.#gameState.evidenceByRole[roleId] ?? [],
      inventoryIds: this.#gameState.inventoryByRole[roleId] ?? [],
      privateInformation: scene.privateInformationByRole[roleId] ?? [],
      availableActions: scene.availableActionsByRole[roleId] ?? [],
    });
  }

  #currentScene(): StoryScene {
    const scene = this.#runtime.story.scenes.find((candidate) => candidate.id === this.#gameState.sceneId);
    if (!scene) throw new Error(`Runtime scene ${this.#gameState.sceneId} does not exist`);
    return scene;
  }

  #currentSceneForState(state: RuntimeGameState): StoryScene {
    const scene = this.#runtime.story.scenes.find((candidate) => candidate.id === state.sceneId);
    if (!scene) throw new Error(`Runtime scene ${state.sceneId} does not exist`);
    return scene;
  }

  #character(roleId: EntityId) {
    const character = this.#characterOrNull(roleId);
    if (!character) throw new Error(`Role ${roleId} does not exist`);
    return character;
  }

  #characterOrNull(roleId: EntityId) {
    return this.#runtime.story.characters.find((character) => character.id === roleId) ?? null;
  }

  #electHost(leavingSessionId: string): void {
    if (this.state.hostSessionId !== leavingSessionId) return;
    this.state.hostSessionId =
      [...this.state.players.values()].find(
        (player) => player.sessionId !== leavingSessionId && !player.isBot,
      )?.sessionId ?? '';
  }

  async #record(
    type: string,
    actorRoleId: EntityId | undefined,
    payload: Record<string, JsonValue>,
  ): Promise<void> {
    const stateHash = hashRuntimeState(this.#gameState);
    this.#gameState.historySequence += 1;
    this.state.sequence = this.#gameState.historySequence;
    await StoryRoom.dependencies.eventStore.append(this.roomId, [
      {
        sequence: this.#gameState.historySequence,
        eventId: crypto.randomUUID(),
        roomId: this.roomId,
        occurredAt: new Date().toISOString(),
        type,
        sceneId: this.#gameState.sceneId,
        ...(actorRoleId ? { actorRoleId } : {}),
        payload,
        stateBeforeHash: stateHash,
        stateAfterHash: stateHash,
      },
    ]);
  }

  static get dependencies(): StoryRoomDependencies {
    if (!this.#dependencies) throw new Error('StoryRoom dependencies were not configured');
    return this.#dependencies;
  }
}

function applyResolutionEventForReplay(
  state: RuntimeGameState,
  event: { type: string; payload: Record<string, JsonValue> },
): RuntimeGameState {
  if (event.type === 'STATE_MUTATED') {
    const operation = event.payload.operation;
    const mutationPath = event.payload.path;
    if (typeof operation !== 'string' || typeof mutationPath !== 'string') {
      throw new Error('Malformed STATE_MUTATED event');
    }
    return applyStateMutation(state, {
      operation: operation as import('@filmgame/shared-types').MutationOperation,
      path: mutationPath,
      ...(event.payload.value === undefined ? {} : { value: event.payload.value }),
    });
  }
  if (event.type === 'SCENE_CHANGED') {
    const sceneId = event.payload.sceneId;
    if (typeof sceneId !== 'string') throw new Error('Malformed SCENE_CHANGED event');
    const next = { ...structuredClone(state), sceneId, phase: 'PLAYING' as const, submittedActions: {} };
    delete next.endingId;
    return next;
  }
  if (event.type === 'ENDING_REACHED') {
    const endingId = event.payload.endingId;
    if (typeof endingId !== 'string') throw new Error('Malformed ENDING_REACHED event');
    return { ...structuredClone(state), endingId, phase: 'ENDING', submittedActions: {} };
  }
  return structuredClone(state);
}

function publicRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  if (event.type !== 'STATE_MUTATED') return structuredClone(event);
  return {
    ...structuredClone(event),
    payload: { operation: event.payload.operation ?? 'UNKNOWN', redacted: true },
  };
}
