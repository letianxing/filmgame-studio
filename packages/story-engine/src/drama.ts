import AjvModule from 'ajv/dist/2020.js';
import schema from '../../story-schema/drama.schema.json' with { type: 'json' };
import type { DramaContent, DramaDocument } from '@filmgame/shared-types';

const Ajv = AjvModule as unknown as new (options: object) => {
  compile(schema: unknown): ((input: unknown) => boolean) & { errors?: unknown };
};
const check = new Ajv({ allErrors: true, strict: false }).compile(schema);
export const dramaContentSchema = schema;

export function validateDrama(input: unknown): asserts input is DramaContent {
  if (!check(input)) throw new Error(`漫剧数据格式不合法：${JSON.stringify(check.errors)}`);
  const drama = input as DramaContent;
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) throw new Error(`重复的实体 ID：${id}`);
    ids.add(id);
  };
  const characters = new Set(drama.characters.map((c) => c.id));
  for (const character of drama.characters) unique(character.id);
  let count = 0;
  for (const episode of drama.episodes) {
    unique(episode.id);
    for (const shot of episode.shots) {
      unique(shot.id);
      count++;
      for (const id of shot.characterIds) if (!characters.has(id)) throw new Error(`镜头引用未知角色：${id}`);
      for (const line of shot.dialogue) {
        if (!shot.characterIds.includes(line.characterId)) throw new Error(`对白角色未出现在镜头：${line.characterId}`);
      }
    }
  }
  if (count > 120) throw new Error('单项目最多 120 个镜头，请按季拆分');
}

export function dramaContent(document: DramaDocument): DramaContent {
  const { title, visualStyle, aspectRatio, characters, episodes } = document;
  return structuredClone({ title, visualStyle, aspectRatio, characters, episodes });
}

export function reviseDrama(current: DramaDocument, input: unknown, expectedVersion: number): DramaDocument {
  if (current.version !== expectedVersion) throw new Error('VERSION_CONFLICT：项目已更新，请刷新后重试');
  validateDrama(input);
  return { ...structuredClone(input), schemaVersion: '1.0.0', projectId: current.projectId,
    version: current.version + 1, parentVersion: current.version };
}

/** Hash these inputs at the execution boundary: edits only invalidate dependent shots. */
export function dramaShotInputs(document: DramaDocument, shotId: string): object {
  const shot = document.episodes.flatMap((e) => e.shots).find((s) => s.id === shotId);
  if (!shot) throw new Error('SHOT_NOT_FOUND');
  return { shot, aspectRatio: document.aspectRatio, visualStyle: document.visualStyle,
    characters: document.characters.filter((c) => shot.characterIds.includes(c.id)) };
}

export function dramaVoiceBlockers(document: DramaContent): string[] {
  const speakers = new Set(document.episodes.flatMap((e) => e.shots.flatMap((s) => s.dialogue.map((d) => d.characterId))));
  return document.characters.filter((c) => speakers.has(c.id)).flatMap((c) => {
    if (!c.voiceId && !c.voiceReferenceAssetId) return [`${c.name}：请绑定音色或上传参考音频`];
    if (!c.rightsConfirmed) return [`${c.name}：请确认声音使用授权`];
    if (c.voiceReferenceAssetId && !c.referenceTranscript.trim()) return [`${c.name}：请填写参考音频的准确文字`];
    return [];
  });
}
