import type { EntityId, JobStatus, ProductionJob } from '@filmgame/shared-types';

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

  constructor(jobs: ProductionJob[]) {
    for (const job of jobs) {
      if (this.#jobs.has(job.id)) throw new Error(`Duplicate job id ${job.id}`);
      this.#jobs.set(job.id, structuredClone(job));
    }
    this.#assertDependenciesExist();
    this.#assertAcyclic();
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
    return this.list().filter((job) => job.status === 'READY');
  }

  get(jobId: EntityId): ProductionJob {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    return structuredClone(job);
  }

  start(jobId: EntityId): ProductionJob {
    this.refreshReadiness();
    const job = this.#required(jobId);
    if (job.status !== 'READY') throw new Error(`Job ${jobId} is ${job.status}, not READY`);
    job.attempt += 1;
    this.#transition(job, 'RUNNING');
    return structuredClone(job);
  }

  succeed(jobId: EntityId, output: ProductionJob['output'] = {}): ProductionJob {
    const job = this.#required(jobId);
    if (job.status !== 'RUNNING') throw new Error(`Job ${jobId} is ${job.status}, not RUNNING`);
    job.output = structuredClone(output);
    delete job.error;
    this.#transition(job, 'SUCCEEDED');
    this.refreshReadiness();
    return structuredClone(job);
  }

  fail(jobId: EntityId, error: string): ProductionJob {
    const job = this.#required(jobId);
    if (job.status !== 'RUNNING') throw new Error(`Job ${jobId} is ${job.status}, not RUNNING`);
    job.error = error;
    this.#transition(job, job.attempt < job.maxAttempts ? 'READY' : 'FAILED', error);
    this.refreshReadiness();
    return structuredClone(job);
  }

  cancel(jobId: EntityId, reason = 'Cancelled'): void {
    const job = this.#required(jobId);
    if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new Error(`Terminal job ${jobId} cannot be cancelled`);
    }
    this.#transition(job, 'CANCELLED', reason);
    this.refreshReadiness();
  }

  refreshReadiness(): void {
    for (const job of this.#jobs.values()) {
      if (!['PENDING', 'READY', 'BLOCKED'].includes(job.status)) continue;
      const dependencies = job.dependencies.map((id) => this.#required(id));
      if (dependencies.some((dependency) => ['FAILED', 'CANCELLED', 'BLOCKED'].includes(dependency.status))) {
        this.#setIfChanged(job, 'BLOCKED', 'A dependency cannot succeed');
      } else if (dependencies.every((dependency) => dependency.status === 'SUCCEEDED')) {
        this.#setIfChanged(job, 'READY');
      } else {
        this.#setIfChanged(job, 'PENDING');
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

