import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { JobTransition } from '@filmgame/job-engine';
import type { ProductionJob, StoryModel } from '@filmgame/shared-types';

import type { SceneBreakdown } from './index.js';

export type ProductionRunExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED_BUDGET'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface ProductionRunSnapshot {
  schemaVersion: '1.0.0';
  runId: string;
  projectId: string;
  storyVersion: number;
  productionVersion: number;
  executionStatus: ProductionRunExecutionStatus;
  updatedAt: string;
  story: StoryModel;
  breakdowns: SceneBreakdown[];
  jobs: ProductionJob[];
  transitions: JobTransition[];
  budget?: {
    currency: string;
    maxAmount: number;
    reservedAmount: number;
    actualAmount: number;
  };
}

export interface ProductionRunStore {
  save(snapshot: ProductionRunSnapshot): Promise<void>;
  load(runId: string): Promise<ProductionRunSnapshot | null>;
  list(): Promise<ProductionRunSnapshot[]>;
}

export class FileProductionRunStore implements ProductionRunStore {
  readonly #root: string;

  constructor(rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new Error('Production run root must be absolute');
    this.#root = path.resolve(rootDirectory);
  }

  async save(snapshot: ProductionRunSnapshot): Promise<void> {
    validateRunId(snapshot.runId);
    await mkdir(this.#root, { recursive: true });
    const destination = this.#resolve(snapshot.runId);
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  }

  async load(runId: string): Promise<ProductionRunSnapshot | null> {
    validateRunId(runId);
    try {
      return validateSnapshot(JSON.parse(await readFile(this.#resolve(runId), 'utf8')));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }

  async list(): Promise<ProductionRunSnapshot[]> {
    try {
      const entries = await readdir(this.#root, { withFileTypes: true });
      const snapshots: ProductionRunSnapshot[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const runId = entry.name.slice(0, -5);
        snapshots.push(validateSnapshot(JSON.parse(await readFile(this.#resolve(runId), 'utf8'))));
      }
      return snapshots.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
  }

  #resolve(runId: string): string {
    const result = path.resolve(this.#root, `${runId}.json`);
    if (!result.startsWith(`${this.#root}${path.sep}`)) throw new Error('Run path escaped root');
    return result;
  }
}

function validateRunId(runId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/u.test(runId)) throw new Error('Invalid production run id');
}

function validateSnapshot(value: unknown): ProductionRunSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run snapshot');
  const record = value as Partial<ProductionRunSnapshot>;
  if (
    record.schemaVersion !== '1.0.0' ||
    typeof record.runId !== 'string' ||
    typeof record.projectId !== 'string' ||
    !Number.isInteger(record.storyVersion) ||
    !Number.isInteger(record.productionVersion) ||
    !record.story ||
    !Array.isArray(record.breakdowns) ||
    !Array.isArray(record.jobs) ||
    !Array.isArray(record.transitions)
  ) {
    throw new Error('Malformed production run snapshot');
  }
  validateRunId(record.runId);
  return structuredClone(record as ProductionRunSnapshot);
}
