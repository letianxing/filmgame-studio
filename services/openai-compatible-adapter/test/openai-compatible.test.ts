import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenAICompatibleLLMProvider } from '../src/index.js';

test('DeepSeek JSON mode sends max_tokens and parses structured response', async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ id: 'deepseek-request', model: 'deepseek-v4-pro', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
  };
  try {
    const provider = new OpenAICompatibleLLMProvider({
      id: 'deepseek-production', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro',
      apiKey: 'secret', structuredMode: 'JSON_OBJECT', maxOutputTokensField: 'max_tokens',
    });
    const result = await provider.generateStructured({ system: 'Return JSON.', prompt: 'JSON only.', jsonSchema: { type: 'object' }, maxOutputTokens: 321 }, { requestId: 'req', projectId: 'project', storyVersion: 1, idempotencyKey: 'idem' });
    assert.deepEqual(result.data, { ok: true });
    assert.equal(body?.max_tokens, 321);
    assert.equal(body?.max_completion_tokens, undefined);
    assert.deepEqual(body?.response_format, { type: 'json_object' });
  } finally { globalThis.fetch = originalFetch; }
});
