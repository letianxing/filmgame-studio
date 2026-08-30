import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import type {
  ProviderContext,
  ProviderHealth,
  ProviderResult,
  StorageProvider,
  StoredObject,
} from '@filmgame/provider-sdk';

export interface LocalStorageConfig {
  rootDirectory: string;
}

export class LocalStorageProvider implements StorageProvider {
  readonly id = 'local-storage';
  readonly kind = 'STORAGE' as const;
  readonly #root: string;

  constructor(readonly config: LocalStorageConfig) {
    if (!path.isAbsolute(config.rootDirectory)) {
      throw new Error('Local storage root must be absolute');
    }
    this.#root = path.resolve(config.rootDirectory);
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      await mkdir(this.#root, { recursive: true });
      await access(this.#root);
      return {
        status: 'HEALTHY',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        details: { rootDirectory: this.#root },
      };
    } catch (cause) {
      return {
        status: 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        message: cause instanceof Error ? cause.message : 'Local storage is unavailable',
      };
    }
  }

  async put(
    key: string,
    source: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
    context: ProviderContext,
  ): Promise<ProviderResult<StoredObject>> {
    const startedAt = new Date().toISOString();
    const destination = this.#resolveKey(key);
    const temporary = `${destination}.${randomUUID()}.partial`;
    await mkdir(path.dirname(destination), { recursive: true });
    const hash = createHash('sha256');
    let sizeBytes = 0;
    try {
      if (source instanceof Uint8Array) {
        hash.update(source);
        sizeBytes = source.byteLength;
        await writeFile(temporary, source, { flag: 'wx' });
      } else {
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk);
            sizeBytes += chunk.byteLength;
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.from(readWebChunks(source)),
          meter,
          createWriteStream(temporary, { flags: 'wx' }),
        );
      }
      const digest = hash.copy().digest('hex');
      const existing = await fileMetadata(destination);
      if (existing) {
        if (existing.size !== sizeBytes || existing.sha256 !== digest) {
          throw new Error(`Immutable asset already exists with different content: ${key}`);
        }
        await rm(temporary, { force: true });
      } else {
        await rename(temporary, destination);
      }
    } catch (cause) {
      await rm(temporary, { force: true });
      throw cause;
    }

    const stored = await stat(destination);
    if (stored.size !== sizeBytes) throw new Error(`Stored byte count mismatch for ${key}`);
    return {
      data: {
        uri: pathToFileURL(destination).href,
        sha256: hash.digest('hex'),
        sizeBytes,
        contentType,
      },
      provider: this.id,
      requestId: context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      usage: [{ unit: 'BYTES', input: sizeBytes, output: sizeBytes }],
      metadata: { key, idempotencyKey: context.idempotencyKey },
    };
  }

  async getSignedReadUri(key: string, expiresInSeconds: number): Promise<string> {
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error('expiresInSeconds must be positive');
    }
    const destination = this.#resolveKey(key);
    await access(destination);
    return pathToFileURL(destination).href;
  }

  #resolveKey(key: string): string {
    const normalized = key.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    const destination = path.resolve(this.#root, ...normalized.split('/'));
    const prefix = `${this.#root}${path.sep}`;
    if (!destination.startsWith(prefix)) throw new Error(`Storage key escaped root: ${key}`);
    return destination;
  }
}

async function* readWebChunks(
  source: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, void, void> {
  const reader = source.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function fileMetadata(
  filename: string,
): Promise<{ size: number; sha256: string } | null> {
  try {
    const details = await stat(filename);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return { size: details.size, sha256: hash.digest('hex') };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
}
