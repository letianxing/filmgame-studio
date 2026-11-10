import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonValue } from "../../shared-types/src/index.js";

export interface ComicCharacter {
  id: string;
  name: string;
  appearance: string;
  voice: string;
}
export interface ComicShot {
  /** Explicit authoring hold: references remain usable, video generation is blocked. */
  generationHold?: string;
  generationMode?: 't2v' | 'm2v' | 'first_last_frame';
  id: string;
  scene: string;
  description: string;
  camera: string;
  durationSeconds: number;
  characterIds: string[];
  dialogue: Array<{ characterId: string; text: string; startSeconds: number; endSeconds: number }>;
}
export interface ComicEpisode {
  id: string;
  title: string;
  synopsis: string;
  shots: ComicShot[];
}
export interface ComicStory {
  title: string;
  logline: string;
  visualStyle: string;
  characters: ComicCharacter[];
  episodes: ComicEpisode[];
}
export type Ratio = "16:9" | "9:16" | "1:1";
const text = { type: "string", minLength: 1, maxLength: 8000 };
const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
export const characterSchema = object({ id, name: text, appearance: text, voice: text });
export const shotSchema = object({
  id,
  scene: text,
  description: text,
  camera: text,
  durationSeconds: { type: "integer", minimum: 4, maximum: 15 },
  characterIds: { type: "array", uniqueItems: true, items: id, maxItems: 12 },
  dialogue: {
    type: "array",
    maxItems: 12,
    items: object({
      characterId: id,
      text,
      startSeconds: { type: "number", minimum: 0 },
      endSeconds: { type: "number", minimum: 0 },
    }),
  },
});
// Optional for compatibility with existing stories and provider structured outputs.
(shotSchema.properties as Record<string, unknown>).generationHold = text;
(shotSchema.properties as Record<string, unknown>).generationMode = { type: 'string', enum: ['t2v', 'm2v', 'first_last_frame'] };
export const outlineSchema = object({
  title: text,
  logline: text,
  visualStyle: text,
  characters: { type: "array", minItems: 1, maxItems: 12, items: characterSchema },
  episodes: {
    type: "array",
    minItems: 1,
    maxItems: 24,
    items: object({ id, title: text, synopsis: text }),
  },
});
export const episodeSchema = object({
  shots: { type: "array", minItems: 1, maxItems: 120, items: shotSchema },
});
export const comicSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...object({
    title: text,
    logline: text,
    visualStyle: text,
    characters: { type: "array", minItems: 1, maxItems: 12, items: characterSchema },
    episodes: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: object({
        id,
        title: text,
        synopsis: text,
        shots: { type: "array", minItems: 1, maxItems: 120, items: shotSchema },
      }),
    },
  }),
};
const ajv = new Ajv2020({ allErrors: true });
export function assertSchema<T>(
  value: unknown,
  schema: Record<string, unknown>,
): asserts value is T {
  const validate = ajv.compile(schema);
  if (!validate(value)) throw new Error(ajv.errorsText(validate.errors).slice(0, 1400));
}
export function validateComic(value: unknown): ComicStory {
  assertSchema<ComicStory>(value, comicSchema);
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) throw new Error(`重复标识：${id}`);
    ids.add(id);
  };
  const roles = new Set(value.characters.map((c) => c.id));
  value.characters.forEach((c) => unique(c.id));
  for (const ep of value.episodes) {
    unique(ep.id);
    for (const shot of ep.shots) {
      unique(shot.id);
      if (shot.characterIds.some((c) => !roles.has(c)))
        throw new Error(`镜头 ${shot.id} 引用了不存在的角色`);
      let end = 0;
      for (const line of shot.dialogue) {
        if (
          !shot.characterIds.includes(line.characterId) ||
          line.startSeconds < end ||
          line.endSeconds <= line.startSeconds ||
          line.endSeconds > shot.durationSeconds
        )
          throw new Error(`镜头 ${shot.id} 的对白角色或时间轴无效`);
        end = line.endSeconds;
      }
    }
  }
  return value;
}
export function nativePrompt(story: ComicStory, shot: ComicShot, options: { appearanceFromReference?: boolean } = {}): string {
  return [
    `制作动态漫剧镜头，保持真实连续动作，禁止静态幻灯片。风格：${story.visualStyle}`,
    ...story.characters
      .filter((c) => shot.characterIds.includes(c.id))
      .map((c) => options.appearanceFromReference
        ? `${c.id} / ${c.name}：外观、服饰、持物与人数严格依照本镜已采纳参考和本镜表演指令；声音：${c.voice}`
        : `${c.id} / ${c.name}：${c.appearance}；声音：${c.voice}`),
    `场景：${shot.scene}`,
    `表演：${shot.description}`,
    `镜头：${shot.camera}`,
    ...shot.dialogue.map(
      (d) =>
        `${d.startSeconds}–${d.endSeconds}秒，${story.characters.find((c) => c.id === d.characterId)?.name}用中文说：“${d.text}”。口型与对白同步。`,
    ),
    "原生生成上述对白与同期环境音；未安排对白的镜头不说话，不添加旁白或额外台词。只让指定说话者在指定时间开口，其他人嘴闭合。保持角色外形与声音一致。配乐统一在后期制作，本镜头不生成音乐。不要生成画面文字、水印、字幕。",
  ].join("\n");
}
export function schemaJson(schema: Record<string, unknown>): Record<string, JsonValue> {
  return schema as Record<string, JsonValue>;
}
