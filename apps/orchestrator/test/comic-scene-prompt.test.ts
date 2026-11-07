import test from 'node:test';
import assert from 'node:assert/strict';
import { nativePrompt, type ComicStory } from '../../../packages/comic-engine/src/index.js';
const story: ComicStory = {
  title: 'Village', logline: 'Negotiation', visualStyle: 'film',
  characters: [{ id: 'guard', name: 'Guard', appearance: 'Single figure, empty hands, no weapons', voice: 'Firm' }],
  episodes: [{ id: 'e1', title: 'Arrival', synopsis: 'Negotiation', shots: [{ id: 's1',
    scene: 'Nine guards in two ranks', description: 'Hold the adopted polearms', camera: 'Fixed wide',
    durationSeconds: 4, characterIds: ['guard'], dialogue: [{ characterId: 'guard', text: 'Stop!', startSeconds: 1, endSeconds: 2 }] }] }],
};
test('adopted scene mode removes standalone concept posing while preserving identity voice and action', () => {
  const shot = story.episodes[0]!.shots[0]!;
  const prompt = nativePrompt(story, shot, { appearanceFromReference: true });
  assert.doesNotMatch(prompt, /Single figure|empty hands|no weapons/);
  for (const text of ['guard / Guard', 'Firm', 'Nine guards', 'adopted polearms', 'Fixed wide', 'Stop!']) assert.ok(prompt.includes(text));
  assert.match(nativePrompt(story, shot), /Single figure, empty hands, no weapons/);
});
