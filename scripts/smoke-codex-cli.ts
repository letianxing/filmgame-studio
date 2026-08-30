import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { CodexCliLLMProvider } from '../services/codex-cli-adapter/src/index.js';

loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
const cliScript = process.env.CODEX_CLI_SCRIPT;
const model = process.env.CODEX_CLI_MODEL;
if (!cliScript || !model) throw new Error('CODEX_CLI_SCRIPT and CODEX_CLI_MODEL are required');

const provider = new CodexCliLLMProvider({
  nodeExecutable: process.execPath,
  cliScript,
  model,
  timeoutMs: 5 * 60_000,
});
const health = await provider.health();
if (health.status !== 'HEALTHY') throw new Error(health.message ?? 'Codex CLI unavailable');
const result = await provider.generateStructured(
  {
    system: 'You are a JSON health-check responder.',
    prompt: 'Return the requested fixed health-check object.',
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'provider'],
      properties: {
        status: { type: 'string', const: 'ok' },
        provider: { type: 'string', const: 'codex-cli' },
      },
    },
    temperature: 0,
    maxOutputTokens: 100,
  },
  {
    requestId: 'codex-cli-smoke',
    projectId: 'snowbound-hotel',
    storyVersion: 1,
    idempotencyKey: 'codex-cli-smoke-v1',
  },
);
console.log(JSON.stringify({ health: health.status, model: result.model, data: result.data }));
