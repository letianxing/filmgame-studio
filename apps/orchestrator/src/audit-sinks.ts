import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { ProductionAuditEvent, ProductionAuditSink } from './index.js';

export class JsonLinesProductionAuditSink implements ProductionAuditSink {
  readonly #filename: string;
  #pending: Promise<void> = Promise.resolve();

  constructor(filename: string) {
    if (!path.isAbsolute(filename)) throw new Error('Production audit log path must be absolute');
    this.#filename = path.resolve(filename);
  }

  record(event: ProductionAuditEvent): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      await mkdir(path.dirname(this.#filename), { recursive: true });
      await appendFile(this.#filename, `${JSON.stringify(event)}\n`, 'utf8');
    });
    return this.#pending;
  }
}
