import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type {
  LLMProvider,
  LLMStructuredRequest,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';
import type { JsonValue } from '@filmgame/shared-types';

export interface CodexCliConfig {
  nodeExecutable: string;
  cliScript: string;
  model: string;
  timeoutMs?: number;
  maximumOutputBytes?: number;
  allowInProduction?: boolean;
}

export class CodexCliLLMProvider implements LLMProvider {
  readonly id = 'codex-cli-development';
  readonly kind = 'LLM' as const;
  #tail: Promise<void> = Promise.resolve();

  constructor(readonly config: CodexCliConfig) {
    if (!path.isAbsolute(config.nodeExecutable) || !path.isAbsolute(config.cliScript)) {
      throw new Error('Codex CLI executable and script paths must be absolute');
    }
    if (!config.model.trim()) throw new Error('Codex CLI model is required');
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const result = await runProcess(
        this.config.nodeExecutable,
        [this.config.cliScript, '--version'],
        '',
        10_000,
        64 * 1024,
      );
      return {
        status: result.exitCode === 0 ? 'HEALTHY' : 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        ...(result.exitCode === 0 ? { details: { version: result.stdout.trim() } } : { message: result.stderr }),
      };
    } catch (cause) {
      return {
        status: 'UNAVAILABLE',
        checkedAt: new Date().toISOString(),
        message: cause instanceof Error ? cause.message : 'Codex CLI unavailable',
      };
    }
  }

  generateStructured<T extends JsonValue>(
    request: LLMStructuredRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<T>> {
    const queued = this.#tail.then(() => this.#generate<T>(request, context));
    this.#tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  async #generate<T extends JsonValue>(
    request: LLMStructuredRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<T>> {
    if (process.env.NODE_ENV === 'production' && !this.config.allowInProduction) {
      throw new ProviderError(
        this.id,
        'UNCONFIGURED',
        'Codex CLI provider is forbidden in production; configure an API LLMProvider',
        false,
      );
    }
    const startedAt = new Date().toISOString();
    const temporary = await mkdtemp(path.join(tmpdir(), 'filmgame-codex-'));
    const schemaPath = path.join(temporary, 'output.schema.json');
    const outputPath = path.join(temporary, 'output.json');
    const strictSchema = isStrictOutputSchema(request.jsonSchema);
    if (strictSchema) await writeFile(schemaPath, JSON.stringify(request.jsonSchema), 'utf8');
    const prompt = [
      request.system,
      '',
      request.prompt,
      '',
      ...(strictSchema
        ? []
        : ['Output must be valid JSON matching this schema:', JSON.stringify(request.jsonSchema), '']),
      'Return only the JSON object required by the supplied output schema. Do not call tools.',
    ].join('\n');
    try {
      const args = [
        this.config.cliScript,
        'exec',
        '--model',
        this.config.model,
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
        '--cd',
        temporary,
        ...(strictSchema ? ['--output-schema', schemaPath] : []),
        '--output-last-message',
        outputPath,
        '--color',
        'never',
        '-',
      ];
      const result = await runProcess(
        this.config.nodeExecutable,
        args,
        prompt,
        this.config.timeoutMs ?? 20 * 60_000,
        2 * 1024 ** 2,
        context.signal,
      );
      if (result.exitCode !== 0) {
        throw new ProviderError(
          this.id,
          'INVALID_RESPONSE',
          `Codex CLI exited ${result.exitCode}: ${result.stderr.slice(-1_000)}`,
          false,
        );
      }
      const details = await stat(outputPath);
      const maximum = this.config.maximumOutputBytes ?? 8 * 1024 ** 2;
      if (details.size < 2 || details.size > maximum) {
        throw new ProviderError(this.id, 'INVALID_RESPONSE', 'Codex CLI output size is invalid', false);
      }
      const data = JSON.parse(stripCodeFence(await readFile(outputPath, 'utf8'))) as T;
      return {
        data,
        provider: this.id,
        model: this.config.model,
        requestId: context.requestId,
        startedAt,
        completedAt: new Date().toISOString(),
        metadata: {
          developmentOnly: true,
          idempotencyKey: context.idempotencyKey,
          schemaMode: strictSchema ? 'STRICT_JSON_SCHEMA' : 'PROMPTED_JSON',
        },
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

function isStrictOutputSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return true;
  const record = schema as Record<string, unknown>;
  // Codex structured output accepts a deliberately smaller JSON Schema subset.
  // Referenced domain schemas and object cardinality constraints still belong to
  // our local Ajv validation/repair boundary, but must not be passed to
  // `--output-schema` because the upstream endpoint rejects them before running.
  if (
    '$defs' in record ||
    'definitions' in record ||
    'minProperties' in record ||
    'maxProperties' in record
  ) {
    return false;
  }
  if (record.type === 'object') {
    const properties =
      record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
        ? (record.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(record.required) ? new Set(record.required) : new Set<unknown>();
    if (record.additionalProperties !== false) return false;
    if (Object.keys(properties).some((key) => !required.has(key))) return false;
    if (Object.values(properties).some((child) => !isStrictOutputSchema(child))) return false;
  }
  if (record.items && !isStrictOutputSchema(record.items)) return false;
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    const children = record[keyword];
    if (Array.isArray(children) && children.some((child) => !isStrictOutputSchema(child))) return false;
  }
  return true;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
    : trimmed;
}

function runProcess(
  executable: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  maximumLogBytes: number,
  signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let capturedBytes = 0;
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    const abort = (): void => {
      child.kill();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const capture = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      capturedBytes += chunk.byteLength;
      if (capturedBytes > maximumLogBytes) {
        child.kill();
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => capture('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => capture('stderr', chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (capturedBytes > maximumLogBytes) {
        reject(new Error('Codex CLI logs exceeded the configured output limit'));
        return;
      }
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}
