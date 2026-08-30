import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexCliLLMProvider } from '../src/index.js';

test('Codex CLI adapter consumes a bounded schema-constrained final message', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-fake-codex-'));
  try {
    const script = path.join(root, 'fake-codex.mjs');
    await writeFile(
      script,
      `const args=process.argv.slice(2);const output=args[args.indexOf('--output-last-message')+1];await import('node:fs/promises').then(fs=>fs.writeFile(output, JSON.stringify({ok:true})));`,
      'utf8',
    );
    const provider = new CodexCliLLMProvider({
      nodeExecutable: process.execPath,
      cliScript: script,
      model: 'fixture',
      timeoutMs: 5_000,
    });
    const result = await provider.generateStructured(
      {
        system: 'Return JSON.',
        prompt: 'Confirm.',
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: { ok: { type: 'boolean' } },
        },
      },
      {
        requestId: 'codex-cli-test',
        projectId: 'project-test',
        storyVersion: 1,
        idempotencyKey: 'codex-cli-test',
      },
    );
    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.metadata.developmentOnly, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex CLI adapter keeps full domain schemas out of the unsupported strict CLI boundary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filmgame-fake-codex-loose-'));
  try {
    const script = path.join(root, 'fake-codex.mjs');
    await writeFile(
      script,
      `const args=process.argv.slice(2);if(args.includes('--output-schema'))process.exit(23);const output=args[args.indexOf('--output-last-message')+1];await import('node:fs/promises').then(fs=>fs.writeFile(output, JSON.stringify({brief:{title:'ok'}})));`,
      'utf8',
    );
    const provider = new CodexCliLLMProvider({
      nodeExecutable: process.execPath,
      cliScript: script,
      model: 'fixture',
      timeoutMs: 5_000,
    });
    const result = await provider.generateStructured(
      {
        system: 'Return JSON.',
        prompt: 'Create a brief.',
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['brief'],
          properties: { brief: { $ref: '#/$defs/brief' } },
          $defs: {
            brief: {
              type: 'object',
              minProperties: 1,
              additionalProperties: { type: 'string' },
            },
          },
        },
      },
      {
        requestId: 'codex-cli-loose-schema-test',
        projectId: 'project-test',
        storyVersion: 1,
        idempotencyKey: 'codex-cli-loose-schema-test',
      },
    );
    assert.deepEqual(result.data, { brief: { title: 'ok' } });
    assert.equal(result.metadata.schemaMode, 'PROMPTED_JSON');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
