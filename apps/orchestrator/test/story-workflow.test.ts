import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
  LLMProvider,
  LLMStructuredRequest,
  ProviderContext,
  ProviderHealth,
  ProviderResult,
} from '@filmgame/provider-sdk';
import type { JsonValue, StoryModel } from '@filmgame/shared-types';

import { StoryGenerationWorkflow } from '../src/story-workflow.js';

const sample = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

class FixtureLLMProvider implements LLMProvider {
  readonly id = 'fixture-llm';
  readonly kind = 'LLM' as const;
  calls: string[] = [];

  async health(): Promise<ProviderHealth> {
    return { status: 'HEALTHY', checkedAt: new Date().toISOString() };
  }

  async generateStructured<T extends JsonValue>(
    _request: LLMStructuredRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<T>> {
    const node = String(context.metadata?.node);
    this.calls.push(node);
    const outputs: Record<string, JsonValue> = {
      PRODUCER: { brief: sample.brief } as unknown as JsonValue,
      NARRATIVE_DESIGNER: {
        world: sample.world,
        narrativeTone: sample.narrativeTone,
        visualBible: sample.visualBible,
        locations: sample.locations,
        chapters: sample.chapters,
      } as unknown as JsonValue,
      CHARACTER_WRITER: {
        characters: sample.characters,
        relationships: sample.relationships,
      } as unknown as JsonValue,
      MULTIPLAYER_GAME_DESIGNER: {
        variables: sample.variables,
        inventory: sample.inventory,
        evidence: sample.evidence,
        scenes: sample.scenes.map(({ script: _script, ...scene }) => scene),
        endings: sample.endings,
      } as unknown as JsonValue,
      SCRIPT_WRITER: {
        scripts: sample.scenes.map((scene) => ({ sceneId: scene.id, script: scene.script ?? '' })),
      } as unknown as JsonValue,
    };
    const now = new Date().toISOString();
    return {
      data: outputs[node] as T,
      provider: this.id,
      model: 'fixture-v1',
      requestId: `${node.toLowerCase()}-request`,
      startedAt: now,
      completedAt: now,
      usage: [{ unit: 'TOKENS', input: 100, output: 200 }],
      metadata: {},
    };
  }
}

test('specialist workflow produces one validated Story Model without a monolithic prompt', async () => {
  const provider = new FixtureLLMProvider();
  const workflow = new StoryGenerationWorkflow(provider);
  const result = await workflow.generate({
    projectId: sample.projectId,
    idea: sample.brief.logline.repeat(2),
    context: { requestId: 'workflow-001' },
  });

  assert.equal(result.story.characters.length, 6);
  assert.equal(result.story.endings.length, 6);
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues, null, 2));
  assert.deepEqual(provider.calls, [
    'PRODUCER',
    'NARRATIVE_DESIGNER',
    'CHARACTER_WRITER',
    'MULTIPLAYER_GAME_DESIGNER',
    'SCRIPT_WRITER',
  ]);
  assert.equal(result.trace.length, 5);
});

