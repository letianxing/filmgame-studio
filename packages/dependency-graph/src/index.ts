import { createHash } from 'node:crypto';

import type { EntityId, JsonValue, ProductionJob } from '@filmgame/shared-types';

export type DependencyNodeState =
  | 'UP_TO_DATE'
  | 'DIRTY'
  | 'STALE'
  | 'NEEDS_REGENERATION'
  | 'BLOCKED';

export interface DependencyNode {
  id: EntityId;
  kind: string;
  entityId?: EntityId;
  state: DependencyNodeState;
  inputHash: string;
  dependencyHash: string;
  outputAssetIds: EntityId[];
}

export interface DependencyEdge {
  from: EntityId;
  to: EntityId;
  reason: string;
  strength: 'HARD' | 'QUALITY' | 'RUNTIME';
}

export interface InvalidationResult {
  changedEntityIds: EntityId[];
  directlyDirtyNodeIds: EntityId[];
  staleNodeIds: EntityId[];
  regenerationNodeIds: EntityId[];
  states: Record<EntityId, DependencyNodeState>;
}

export class AssetDependencyGraph {
  readonly #nodes = new Map<EntityId, DependencyNode>();
  readonly #outgoing = new Map<EntityId, DependencyEdge[]>();

  constructor(nodes: DependencyNode[], readonly edges: DependencyEdge[]) {
    for (const node of nodes) {
      if (this.#nodes.has(node.id)) throw new Error(`Duplicate dependency node ${node.id}`);
      this.#nodes.set(node.id, structuredClone(node));
    }
    for (const edge of edges) {
      if (!this.#nodes.has(edge.from) || !this.#nodes.has(edge.to)) {
        throw new Error(`Dependency edge ${edge.from} -> ${edge.to} references a missing node`);
      }
      this.#outgoing.set(edge.from, [...(this.#outgoing.get(edge.from) ?? []), structuredClone(edge)]);
    }
  }

  list(): DependencyNode[] {
    return [...this.#nodes.values()].map((node) => structuredClone(node));
  }

  invalidate(changedEntityIds: EntityId[]): InvalidationResult {
    const changed = new Set(changedEntityIds);
    const direct = [...this.#nodes.values()].filter((node) => node.entityId && changed.has(node.entityId));
    const queue = direct.map((node) => node.id);
    const visited = new Set(queue);
    for (const node of direct) node.state = 'DIRTY';
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of this.#outgoing.get(current) ?? []) {
        if (edge.strength !== 'HARD' || visited.has(edge.to)) continue;
        visited.add(edge.to);
        queue.push(edge.to);
        const downstream = this.#nodes.get(edge.to)!;
        if (downstream.state !== 'DIRTY') downstream.state = 'STALE';
      }
    }
    const regenerationNodeIds = [...visited];
    for (const id of regenerationNodeIds) {
      const node = this.#nodes.get(id)!;
      if (node.state === 'DIRTY' || node.state === 'STALE') node.state = 'NEEDS_REGENERATION';
    }
    return {
      changedEntityIds: [...changed],
      directlyDirtyNodeIds: direct.map((node) => node.id),
      staleNodeIds: regenerationNodeIds.filter((id) => !direct.some((node) => node.id === id)),
      regenerationNodeIds,
      states: Object.fromEntries([...this.#nodes.values()].map((node) => [node.id, node.state])),
    };
  }
}

export function graphFromProductionJobs(jobs: ProductionJob[]): AssetDependencyGraph {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const nodes: DependencyNode[] = jobs.map((job) => ({
    id: job.id,
    kind: job.type,
    ...(job.entityId ? { entityId: job.entityId } : inferEntityId(job.input)),
    state: job.status === 'SUCCEEDED' ? 'UP_TO_DATE' : job.status === 'BLOCKED' ? 'BLOCKED' : 'UP_TO_DATE',
    inputHash: job.inputHash ?? hash(job.input ?? {}),
    dependencyHash:
      job.dependencyHash ??
      hash(
        job.dependencies.map((id) => ({ id, inputHash: byId.get(id)?.inputHash ?? null })) as unknown as JsonValue,
      ),
    outputAssetIds: job.outputAssets ?? outputAssetIds(job.output),
  }));
  const edges = jobs.flatMap((job) =>
    job.dependencies.map((dependency) => ({
      from: dependency,
      to: job.id,
      reason: `${job.type} requires ${byId.get(dependency)?.type ?? dependency}`,
      strength: 'HARD' as const,
    })),
  );
  return new AssetDependencyGraph(nodes, edges);
}

export function previewProductionInvalidation(
  jobs: ProductionJob[],
  changedEntityIds: EntityId[],
): InvalidationResult {
  const graph = graphFromProductionJobs(
    jobs.map((job) => {
      const referencesChanged = containsAny(job.input, new Set(changedEntityIds));
      const affectedEntityId = changedEntityIds.find((id) => containsValue(job.input, id));
      return referencesChanged && !job.entityId && affectedEntityId
        ? { ...job, entityId: affectedEntityId }
        : job;
    }),
  );
  return graph.invalidate(changedEntityIds);
}

function inferEntityId(input: Record<string, JsonValue> | undefined): { entityId?: EntityId } {
  if (!input) return {};
  for (const key of ['characterId', 'locationId', 'sceneId', 'shotId']) {
    const value = input[key];
    if (typeof value === 'string') return { entityId: value };
  }
  return {};
}

function containsAny(value: JsonValue | undefined, targets: Set<string>): boolean {
  return [...targets].some((target) => containsValue(value, target));
}

function containsValue(value: JsonValue | undefined, target: string): boolean {
  if (value === target) return true;
  if (Array.isArray(value)) return value.some((child) => containsValue(child, target));
  if (value && typeof value === 'object') return Object.values(value).some((child) => containsValue(child, target));
  return false;
}

function outputAssetIds(output: Record<string, JsonValue> | undefined): EntityId[] {
  if (!output) return [];
  const ids = new Set<EntityId>();
  const visit = (value: JsonValue): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === 'object') {
      if (typeof value.assetId === 'string') ids.add(value.assetId);
      Object.values(value).forEach(visit);
    }
  };
  visit(output);
  return [...ids];
}

function hash(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
