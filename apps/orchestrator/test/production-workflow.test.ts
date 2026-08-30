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

import { ProductionPlanningWorkflow } from '../src/production-workflow.js';

const story = JSON.parse(
  readFileSync(new URL('../../../examples/snowbound-hotel/story.json', import.meta.url), 'utf8'),
) as StoryModel;

class DirectorFixtureProvider implements LLMProvider {
  readonly id = 'fixture-director';
  readonly kind = 'LLM' as const;

  async health(): Promise<ProviderHealth> {
    return { status: 'HEALTHY', checkedAt: new Date().toISOString() };
  }

  async generateStructured<T extends JsonValue>(
    _request: LLMStructuredRequest,
    context: ProviderContext,
  ): Promise<ProviderResult<T>> {
    const sceneId = String(context.metadata?.sceneId);
    const scene = story.scenes.find((candidate) => candidate.id === sceneId);
    const ending = story.endings.find((candidate) => candidate.id === sceneId);
    assert(scene || ending);
    const roleIds = scene?.rolesPresent ?? Object.keys(ending!.characterResults);
    const locationId = scene?.locationId ?? story.locations[0]!.id;
    const title = scene?.title ?? ending!.title;
    const description = scene?.summary ?? ending!.summary;
    const now = new Date().toISOString();
    return {
      data: {
        shots: [
          {
            id: `shot-${sceneId}`,
            sceneId,
            characterIds: roleIds,
            locationId,
            description,
            dialogue: [{ characterId: roleIds[0], text: scene?.script ?? title }],
            camera: '35mm locked medium-wide, slow push-in',
            durationSeconds: 8,
            imagePrompt: `${story.visualBible.style}; ${title}`,
            videoPrompt: `${story.visualBible.cinematography}; ${title}`,
          },
        ],
      } as unknown as T,
      provider: this.id,
      model: 'fixture-director-v1',
      requestId: `director-${sceneId}`,
      startedAt: now,
      completedAt: now,
      metadata: {},
    };
  }
}

test('director workflow creates shot-level storyboard, media, voice and package jobs', async () => {
  const workflow = new ProductionPlanningWorkflow(new DirectorFixtureProvider());
  const result = await workflow.plan({
    story,
    productionVersion: 1,
    context: { requestId: 'production-workflow-001' },
  });

  const unitCount = story.scenes.length + story.endings.length;
  assert.equal(result.breakdowns.length, unitCount);
  assert.equal(result.plan.summary.STORYBOARD, unitCount);
  assert.equal(result.plan.summary.IMAGE, story.characters.length + story.locations.length + unitCount);
  assert.equal(result.plan.summary.VIDEO, unitCount);
  assert.equal(result.plan.summary.TTS, unitCount);
  assert.equal(result.plan.summary.SUBTITLE, unitCount);
  assert.equal(result.plan.summary.MUSIC, unitCount);
  assert.equal(result.plan.summary.SFX, unitCount);
  assert.equal(result.plan.summary.MEDIA_RENDER, unitCount * 2);
  assert.equal(result.plan.summary.QA, unitCount);
  assert.equal(result.plan.summary.PACKAGE, 1);
  const storyboard = result.plan.graph.list().find((job) => job.type === 'STORYBOARD');
  assert.equal(typeof storyboard?.input?.bibleVersion, 'number');
  assert.ok(Array.isArray(storyboard?.input?.canonicalCharacterRecordIds));
  assert.equal(typeof storyboard?.input?.canonicalLocationRecordId, 'string');
  assert.deepEqual(result.plan.graph.ready().map((job) => job.id), ['director-breakdown']);
});
