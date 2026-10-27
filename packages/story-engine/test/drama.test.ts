import assert from 'node:assert/strict';
import test from 'node:test';
import { dramaContent, dramaShotInputs, dramaVoiceBlockers, reviseDrama, validateDrama } from '../src/drama.js';
import type { DramaDocument } from '@filmgame/shared-types';

export const sampleDrama: DramaDocument = {
  schemaVersion: '1.0.0', projectId: 'drama-test', version: 1, parentVersion: null,
  title: '雨夜来信', visualStyle: '水彩漫画', aspectRatio: '9:16',
  characters: [{ id: 'lin', name: '林', appearance: '蓝色外套，短发', voiceId: '',
    referenceImageAssetId: '', voiceReferenceAssetId: '', referenceTranscript: '', rightsConfirmed: false }],
  episodes: [{ id: 'episode-one', title: '来信', shots: [{ id: 'shot-one', description: '林打开信封', camera: '近景',
    durationSeconds: 5, characterIds: ['lin'], dialogue: [{ characterId: 'lin', text: '是你的信。' }] }] }],
};
test('linear drama validates with one character and no multiplayer fields', () => {
  validateDrama(dramaContent(sampleDrama));
  const silent = dramaContent(sampleDrama); silent.characters = []; silent.episodes[0]!.shots[0]!.characterIds = [];
  silent.episodes[0]!.shots[0]!.dialogue = []; validateDrama(silent);
});
test('schema and references reject malformed model output', () => {
  const wrong = dramaContent(sampleDrama); wrong.episodes[0]!.shots[0]!.characterIds = ['missing'];
  assert.throws(() => validateDrama(wrong), /未知角色/);
  assert.throws(() => validateDrama({ ...dramaContent(sampleDrama), playerCount: 6 }), /格式/);
  wrong.episodes[0]!.shots[0]!.id = 'lin'; assert.throws(() => validateDrama(wrong), /重复/);
});
test('versioned revision protects history and rejects concurrent writes', () => {
  const changed = dramaContent(sampleDrama); changed.title = '新标题';
  const next = reviseDrama(sampleDrama, changed, 1);
  assert.equal(next.version, 2); assert.equal(next.parentVersion, 1); assert.equal(sampleDrama.title, '雨夜来信');
  assert.throws(() => reviseDrama(next, changed, 1), /VERSION_CONFLICT/);
});
test('shot dependency inputs include appearance and voice, not unrelated title', () => {
  const next = structuredClone(sampleDrama); next.title = '新标题';
  assert.deepEqual(dramaShotInputs(next, 'shot-one'), dramaShotInputs(sampleDrama, 'shot-one'));
  next.characters[0]!.appearance = '红衣';
  assert.notDeepEqual(dramaShotInputs(next, 'shot-one'), dramaShotInputs(sampleDrama, 'shot-one'));
});
test('voice binding and permission are creator data, required only for speakers', () => {
  const next = dramaContent(sampleDrama); assert.equal(dramaVoiceBlockers(next).length, 1);
  next.characters[0]!.voiceId = 'voice-a'; assert.equal(dramaVoiceBlockers(next).length, 1);
  next.characters[0]!.rightsConfirmed = true; assert.deepEqual(dramaVoiceBlockers(next), []);
});

test('shot first frame is validated, versioned and part of dependent inputs', () => {
  const input = dramaContent(sampleDrama);
  input.episodes[0]!.shots[0]!.firstFrameAssetId = `asset-${'a'.repeat(64)}`;
  validateDrama(input);
  const next = reviseDrama(sampleDrama, input, 1);
  assert.notDeepEqual(dramaShotInputs(next, 'shot-one'), dramaShotInputs(sampleDrama, 'shot-one'));
  input.episodes[0]!.shots[0]!.firstFrameAssetId = 'file:///not-an-owned-asset';
  assert.throws(() => validateDrama(input), /格式/);
});
