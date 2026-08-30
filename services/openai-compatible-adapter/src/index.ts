import type {
  LLMProvider,
  LLMStructuredRequest,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
} from '@filmgame/provider-sdk';
import { ProviderError } from '@filmgame/provider-sdk';
import type { JsonValue } from '@filmgame/shared-types';

export interface OpenAICompatibleConfig {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  structuredMode?: 'JSON_SCHEMA' | 'JSON_OBJECT';
  maxOutputTokensField?: 'max_tokens' | 'max_completion_tokens';
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly kind = 'LLM' as const;
  readonly id: string;
  readonly #baseUrl: string;

  constructor(readonly config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.#baseUrl}/models`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(3_000),
      });
      return {
        status: response.ok ? 'HEALTHY' : 'DEGRADED',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        ...(response.ok ? {} : { message: `HTTP ${response.status}` }),
      };
    } catch (cause) {
      return {
        status: this.config.apiKey ? 'UNAVAILABLE' : 'UNCONFIGURED',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - started),
        message: cause instanceof Error ? cause.message : 'LLM provider unavailable',
      };
    }
  }

  async generateStructured<T extends JsonValue>(
    request: LLMStructuredRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<T>> {
    const startedAt = new Date().toISOString();
    const useStrictSchema =
      this.config.structuredMode !== 'JSON_OBJECT' && isStrictOutputSchema(request.jsonSchema);
    const responseFormat =
      !useStrictSchema
        ? { type: 'json_object' }
        : {
            type: 'json_schema',
            json_schema: {
              name: 'filmgame_structured_response',
              strict: true,
              schema: request.jsonSchema,
            },
          };

    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers() },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          temperature: request.temperature ?? 0.4,
          ...(request.maxOutputTokens
            ? { [this.config.maxOutputTokensField ?? 'max_completion_tokens']: request.maxOutputTokens }
            : {}),
          response_format: responseFormat,
        }),
        signal: combineSignals(
          context.signal,
          AbortSignal.timeout(this.config.timeoutMs ?? 5 * 60_000),
        ),
      });
    } catch (cause) {
      throw new ProviderError(this.id, 'UNAVAILABLE', 'Unable to reach LLM provider', true, cause);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_500);
      throw new ProviderError(
        this.id,
        response.status === 429 ? 'QUOTA' : 'INVALID_RESPONSE',
        `LLM provider returned HTTP ${response.status}: ${detail}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part) => part.text ?? '').join('')
      : content;
    if (!text) {
      throw new ProviderError(this.id, 'INVALID_RESPONSE', 'LLM response has no content', false);
    }

    let data: T;
    try {
      data = JSON.parse(stripCodeFence(text)) as T;
    } catch (cause) {
      throw new ProviderError(this.id, 'INVALID_RESPONSE', 'LLM response is not valid JSON', false, cause);
    }

    return {
      data,
      provider: this.id,
      model: payload.model ?? this.config.model,
      requestId: payload.id ?? context.requestId,
      startedAt,
      completedAt: new Date().toISOString(),
      usage: [
        {
          unit: 'TOKENS',
          input: payload.usage?.prompt_tokens ?? 0,
          output: payload.usage?.completion_tokens ?? 0,
        },
      ],
      metadata: {
        idempotencyKey: context.idempotencyKey,
        schemaMode: useStrictSchema ? 'STRICT_JSON_SCHEMA' : 'JSON_OBJECT',
      },
    };
  }

  #headers(): Record<string, string> {
    return {
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.headers ?? {}),
    };
  }
}

function isStrictOutputSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return true;
  const record = schema as Record<string, unknown>;
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

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => Boolean(signal)));
}
