import type {
  Condition,
  EntityId,
  JsonValue,
  ResolutionRule,
  RuntimeGameState,
  StateMutation,
  StoryScene,
  SubmittedAction,
} from '@filmgame/shared-types';

export interface ResolutionContext {
  roomId: string;
  scene: StoryScene;
  state: RuntimeGameState;
  actions: SubmittedAction[];
  now: string;
}

export interface ResolutionEvent {
  type: 'ACTION_ACCEPTED' | 'RULE_MATCHED' | 'STATE_MUTATED' | 'SCENE_CHANGED' | 'ENDING_REACHED';
  actorRoleId?: EntityId;
  payload: Record<string, JsonValue>;
}

export interface ResolutionResult {
  matchedRuleId: EntityId;
  state: RuntimeGameState;
  events: ResolutionEvent[];
}

export class ResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ResolutionError';
  }
}

export function resolveScene(context: ResolutionContext): ResolutionResult {
  const validActions = validateSubmittedActions(context.scene, context.actions);
  const evaluationContext = {
    ...structuredClone(context.state),
    actions: Object.fromEntries(validActions.map((action) => [action.roleId, action])),
  };

  const rule = [...context.scene.resolutionRules]
    .sort((left, right) => right.priority - left.priority)
    .find((candidate) => evaluateCondition(candidate.when, evaluationContext));

  if (!rule) {
    throw new ResolutionError(
      'NO_MATCHING_RULE',
      `Scene ${context.scene.id} produced no deterministic resolution`,
    );
  }

  let nextState: RuntimeGameState = {
    ...structuredClone(context.state),
    phase: 'RESOLVING',
    submittedActions: Object.fromEntries(
      validActions.map((action) => [action.roleId, structuredClone(action)]),
    ),
  };
  const events: ResolutionEvent[] = validActions.map((action) => ({
    type: 'ACTION_ACCEPTED',
    actorRoleId: action.roleId,
    payload: { actionId: action.actionId, ...(action.targetId ? { targetId: action.targetId } : {}) },
  }));
  events.push({ type: 'RULE_MATCHED', payload: { ruleId: rule.id } });

  for (const mutation of rule.mutations) {
    nextState = applyStateMutation(nextState, mutation);
    events.push({
      type: 'STATE_MUTATED',
      payload: {
        operation: mutation.operation,
        path: mutation.path,
        ...(mutation.value === undefined ? {} : { value: mutation.value }),
      },
    });
  }

  if (rule.endingId) {
    nextState = {
      ...nextState,
      phase: 'ENDING',
      endingId: rule.endingId,
      historySequence: nextState.historySequence + events.length + 1,
    };
    events.push({ type: 'ENDING_REACHED', payload: { endingId: rule.endingId } });
  } else if (rule.nextSceneId) {
    nextState = {
      ...nextState,
      phase: 'PLAYING',
      sceneId: rule.nextSceneId,
      historySequence: nextState.historySequence + events.length + 1,
      submittedActions: {},
    };
    events.push({ type: 'SCENE_CHANGED', payload: { sceneId: rule.nextSceneId } });
  } else {
    throw new ResolutionError(
      'RULE_HAS_NO_DESTINATION',
      `Rule ${rule.id} has neither nextSceneId nor endingId`,
    );
  }

  return { matchedRuleId: rule.id, state: nextState, events };
}

export function validateSubmittedActions(
  scene: StoryScene,
  actions: SubmittedAction[],
): SubmittedAction[] {
  const byRole = new Map<EntityId, SubmittedAction>();
  const rolesPresent = new Set(scene.rolesPresent);

  for (const action of actions) {
    if (!rolesPresent.has(action.roleId)) {
      throw new ResolutionError(
        'ROLE_NOT_PRESENT',
        `Role ${action.roleId} is not present in scene ${scene.id}`,
      );
    }
    if (byRole.has(action.roleId)) {
      throw new ResolutionError('DUPLICATE_ROLE_ACTION', `Role ${action.roleId} submitted twice`);
    }
    const available = scene.availableActionsByRole[action.roleId] ?? [];
    if (!available.some((candidate) => candidate.id === action.actionId)) {
      throw new ResolutionError(
        'ACTION_NOT_AUTHORIZED',
        `Action ${action.actionId} is not available to role ${action.roleId}`,
      );
    }
    byRole.set(action.roleId, structuredClone(action));
  }

  return [...byRole.values()];
}

export function evaluateCondition(condition: Condition, context: unknown): boolean {
  if ('all' in condition) return condition.all.every((child) => evaluateCondition(child, context));
  if ('any' in condition) return condition.any.some((child) => evaluateCondition(child, context));
  if ('not' in condition) return !evaluateCondition(condition.not, context);

  const actual = readPath(context, condition.path);
  const expected = condition.value;
  switch (condition.operator) {
    case 'EXISTS':
      return actual !== undefined;
    case 'EQ':
      return deepEqual(actual, expected);
    case 'NE':
      return !deepEqual(actual, expected);
    case 'GT':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'GTE':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'LT':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'LTE':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'IN':
      return Array.isArray(expected) && expected.some((item) => deepEqual(item, actual));
    case 'CONTAINS':
      return Array.isArray(actual)
        ? actual.some((item) => deepEqual(item, expected))
        : typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
  }
}

export function applyStateMutation(
  state: RuntimeGameState,
  mutation: StateMutation,
): RuntimeGameState {
  const next = structuredClone(state) as unknown as Record<string, unknown>;
  const current = readPath(next, mutation.path);

  switch (mutation.operation) {
    case 'SET':
      writePath(next, mutation.path, structuredClone(mutation.value));
      break;
    case 'INCREMENT':
      if (typeof current !== 'number' || typeof mutation.value !== 'number') {
        throw invalidNumberMutation(mutation);
      }
      writePath(next, mutation.path, current + mutation.value);
      break;
    case 'DECREMENT':
      if (typeof current !== 'number' || typeof mutation.value !== 'number') {
        throw invalidNumberMutation(mutation);
      }
      writePath(next, mutation.path, current - mutation.value);
      break;
    case 'SET_RELATIONSHIP': {
      if (typeof mutation.value !== 'number') {
        throw new ResolutionError('INVALID_MUTATION_VALUE', 'Relationship value must be numeric');
      }
      writePath(next, mutation.path, clamp(mutation.value, -100, 100));
      break;
    }
    case 'ADD_TO_SET':
    case 'GRANT_ITEM':
    case 'REVEAL_EVIDENCE': {
      if (!Array.isArray(current)) {
        throw new ResolutionError('INVALID_MUTATION_TARGET', `${mutation.path} is not an array`);
      }
      if (mutation.value === undefined) {
        throw new ResolutionError('INVALID_MUTATION_VALUE', `${mutation.operation} requires a value`);
      }
      const values = current as unknown[];
      if (!values.some((item) => deepEqual(item, mutation.value))) {
        values.push(structuredClone(mutation.value));
      }
      break;
    }
    case 'REMOVE_FROM_SET':
    case 'REVOKE_ITEM': {
      if (!Array.isArray(current)) {
        throw new ResolutionError('INVALID_MUTATION_TARGET', `${mutation.path} is not an array`);
      }
      const index = current.findIndex((item) => deepEqual(item, mutation.value));
      if (index >= 0) current.splice(index, 1);
      break;
    }
  }

  return next as unknown as RuntimeGameState;
}

export function selectEnding(
  endings: Array<{ id: EntityId; priority: number; condition: Condition }>,
  state: RuntimeGameState,
): EntityId | null {
  return (
    [...endings]
      .sort((left, right) => right.priority - left.priority)
      .find((ending) => evaluateCondition(ending.condition, state))?.id ?? null
  );
}

function readPath(value: unknown, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let current = value;
  for (const segment of segments) {
    assertSafeSegment(segment);
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) throw new ResolutionError('INVALID_MUTATION_PATH', 'Mutation path is empty');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    assertSafeSegment(segment);
    const child = current[segment];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      throw new ResolutionError('INVALID_MUTATION_PATH', `Mutation parent ${segment} does not exist`);
    }
    current = child as Record<string, unknown>;
  }
  const key = segments.at(-1)!;
  assertSafeSegment(key);
  if (!(key in current)) {
    throw new ResolutionError('INVALID_MUTATION_PATH', `Mutation target ${path} does not exist`);
  }
  current[key] = value;
}

function assertSafeSegment(segment: string): void {
  if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
    throw new ResolutionError('UNSAFE_STATE_PATH', `Unsafe state path segment: ${segment}`);
  }
}

function invalidNumberMutation(mutation: StateMutation): ResolutionError {
  return new ResolutionError(
    'INVALID_MUTATION_VALUE',
    `${mutation.operation} requires numeric target and value`,
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function ruleFromStory(rule: ResolutionRule): ResolutionRule {
  return structuredClone(rule);
}
