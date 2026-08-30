import { createHash } from 'node:crypto';

import type { EntityId, JobStatus, JsonValue, ProductionJob } from '@filmgame/shared-types';

export interface JobTransition {
  jobId: EntityId;
  from: JobStatus;
  to: JobStatus;
  at: string;
  reason?: string;
}

export class JobGraph {
  readonly #jobs = new Map<EntityId, ProductionJob>();
  readonly #transitions: JobTransition[] = [];

  constructor(jobs: ProductionJob[], options: { recoverRunning?: boolean; now?: string } = {}) {
    for (const job of jobs) {
      if (this.#jobs.has(job.id)) throw new Error(`Duplicate job id ${job.id}`);
      this.#jobs.set(job.id, structuredClone(job));
    }
    this.#assertDependenciesExist();
    this.#assertAcyclic();
    if (options.recoverRunning) this.recoverInterrupted(options.now ?? new Date().toISOString());
    this.refreshReadiness();
  }

  list(): ProductionJob[] {
    return [...this.#jobs.values()].map((job) => structuredClone(job));
  }

  transitions(): JobTransition[] {
    return structuredClone(this.#transitions);
  }

  ready(): ProductionJob[] {
    this.refreshReadiness();
    return this.list().filter((job) => job.status === 'READY' || job.status === 'RETRYING');
  }

  get(jobId: EntityId): ProductionJob {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    return structuredClone(job);
  }

  start(jobId: EntityId): ProductionJob {
    this.refreshReadiness();
    const job = this.#required(jobId);
    if (job.status !== 'READY' && job.status !== 'RETRYING') {
      throw new Error(`Job ${jobId} is ${job.status}, not READY/RETRYING`);
    }
    job.attempt += 1;
    const now = new Date().toISOString();
    job.startedAt = now;
    job.lastHeartbeat = now;
    job.progress = 0;
    delete job.completedAt;
    this.#transition(job, 'RUNNING');
    return structuredClone(job);
  }

  succeed(jobId: EntityId, output: ProductionJob['output'] = {}): ProductionJob {
    const job = this.#required(jobId);
    if (job.status !== 'RUNNING') throw new Error(`Job ${jobId} is ${job.status}, not RUNNING`);
    job.output = structuredClone(output);
    delete job.error;
    job.progress = 1;
    job.completedAt = new Date().toISOString();
    this.#transition(job, 'SUCCEEDED');
    this.refreshReadiness();
    return structuredClone(job);
  }

  fail(jobId: EntityId, error: string): ProductionJob {
    const job = this.#required(jobId);
    if (job.status !== 'RUNNING') throw new Error(`Job ${jobId} is ${job.status}, not RUNNING`);
    job.error = error;
    if (job.attempt >= job.maxAttempts) job.completedAt = new Date().toISOString();
    this.#transition(job, job.attempt < job.maxAttempts ? 'RETRYING' : 'FAILED', error);
    this.refreshReadiness();
    return structuredClone(job);
  }

  cancel(jobId: EntityId, reason = 'Cancelled'): void {
    const job = this.#required(jobId);
    if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new Error(`Terminal job ${jobId} cannot be cancelled`);
    }
    this.#transition(job, 'CANCELLED', reason);
    job.completedAt = new Date().toISOString();
    this.refreshReadiness();
  }

  heartbeat(jobId: EntityId, progress?: number, at = new Date().toISOString()): ProductionJob {
    const job = this.#required(jobId);
    if (job.status !== 'RUNNING') throw new Error(`Job ${jobId} is ${job.status}, not RUNNING`);
    if (progress !== undefined && (!Number.isFinite(progress) || progress < 0 || progress > 1)) {
      throw new Error('Job progress must be within 0-1');
    }
    job.lastHeartbeat = at;
    if (progress !== undefined) job.progress = progress;
    return structuredClone(job);
  }

  pause(jobId: EntityId, reason = 'Paused'): void {
    const job = this.#required(jobId);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      throw new Error(`Terminal job ${jobId} cannot be paused`);
    }
    this.#transition(job, 'PAUSED', reason);
  }

  resume(jobId: EntityId): void {
    const job = this.#required(jobId);
    if (job.status !== 'PAUSED') throw new Error(`Job ${jobId} is ${job.status}, not PAUSED`);
    this.#transition(job, 'PENDING', 'Resumed');
    this.refreshReadiness();
  }

  markStale(jobId: EntityId, reason = 'Inputs changed'): void {
    const job = this.#required(jobId);
    if (job.status === 'RUNNING') throw new Error(`Running job ${jobId} cannot be marked stale`);
    delete job.output;
    delete job.completedAt;
    job.progress = 0;
    this.#transition(job, 'STALE', reason);
  }

  recoverInterrupted(at = new Date().toISOString()): number {
    let recovered = 0;
    for (const job of this.#jobs.values()) {
      if (job.status !== 'RUNNING' && job.status !== 'WAITING') continue;
      job.error = 'Worker interrupted; safe retry scheduled from durable snapshot';
      job.lastHeartbeat = at;
      this.#transition(job, 'RETRYING', job.error);
      recovered += 1;
    }
    return recovered;
  }

  refreshReadiness(): void {
    for (const job of this.#jobs.values()) {
      if (!['PENDING', 'READY', 'BLOCKED', 'STALE', 'RETRYING'].includes(job.status)) continue;
      const dependencies = job.dependencies.map((id) => this.#required(id));
      if (dependencies.some((dependency) => ['FAILED', 'CANCELLED', 'BLOCKED'].includes(dependency.status))) {
        this.#setIfChanged(job, 'BLOCKED', 'A dependency cannot succeed');
      } else if (dependencies.every((dependency) => dependency.status === 'SUCCEEDED')) {
        if (job.status !== 'RETRYING') this.#setIfChanged(job, 'READY');
      } else {
        if (job.status !== 'RETRYING') this.#setIfChanged(job, 'PENDING');
      }
    }
  }

  progress(): { completed: number; total: number; ratio: number } {
    const jobs = [...this.#jobs.values()];
    const completed = jobs.filter((job) => job.status === 'SUCCEEDED').length;
    return { completed, total: jobs.length, ratio: jobs.length ? completed / jobs.length : 1 };
  }

  #required(jobId: EntityId): ProductionJob {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    return job;
  }

  #setIfChanged(job: ProductionJob, status: JobStatus, reason?: string): void {
    if (job.status !== status) this.#transition(job, status, reason);
  }

  #transition(job: ProductionJob, status: JobStatus, reason?: string): void {
    const from = job.status;
    job.status = status;
    this.#transitions.push({
      jobId: job.id,
      from,
      to: status,
      at: new Date().toISOString(),
      ...(reason ? { reason } : {}),
    });
  }

  #assertDependenciesExist(): void {
    for (const job of this.#jobs.values()) {
      for (const dependencyId of job.dependencies) {
        if (!this.#jobs.has(dependencyId)) {
          throw new Error(`Job ${job.id} depends on missing job ${dependencyId}`);
        }
      }
    }
  }

  #assertAcyclic(): void {
    const visiting = new Set<EntityId>();
    const visited = new Set<EntityId>();

    const visit = (jobId: EntityId): void => {
      if (visiting.has(jobId)) throw new Error(`Production job graph contains a cycle at ${jobId}`);
      if (visited.has(jobId)) return;
      visiting.add(jobId);
      for (const dependency of this.#required(jobId).dependencies) visit(dependency);
      visiting.delete(jobId);
      visited.add(jobId);
    };

    for (const jobId of this.#jobs.keys()) visit(jobId);
  }
}

export function hashJobInput(input: Record<string, JsonValue> | undefined): string {
  return createHash('sha256').update(canonicalJson(input ?? {})).digest('hex');
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
