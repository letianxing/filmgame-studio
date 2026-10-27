import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../story-schema/screenplay.schema.json' with { type: 'json' };

export interface ScreenplayContent {
  title: string; format: 'SHORT_FILM' | 'FEATURE_FILM' | 'SERIES'; targetMinutes: number;
  stage: 'PREMISE' | 'STRUCTURE' | 'CHARACTERS' | 'OUTLINE' | 'DRAFT' | 'REVISION' | 'HANDOFF';
  premise: string; theme: string; ending: string; confirmedConstraints: string[];
  lockedFields: Array<'title' | 'format' | 'targetMinutes' | 'ending' | 'characters'>;
  characters: Array<{ id: string; name: string; goal: string; need: string; opposition: string; change: string; voice: string }>;
  beats: Array<{ id: string; summary: string; characterIds: string[] }>;
  scenes: Array<{ id: string; order: number; heading: string; characterIds: string[]; goal: string; conflict: string;
    turn: string; action: string; dialogue: Array<{ characterId: string; text: string }>; estimatedSeconds: number | null }>;
  openQuestions: string[]; nextStep: string;
}
export interface ScreenplayDocument {
  schemaVersion: '1.0.0'; projectId: string; version: number; parentVersion: number | null;
  createdAt: string; changeReason: string; content: ScreenplayContent;
}
export interface ScreenplayRevisionOptions {
  expectedVersion: number; reason: string; scope?: 'full' | 'dialogue'; sceneIds?: string[];
  allowLockedChanges?: boolean;
}
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
export function validateScreenplay(input: unknown): asserts input is ScreenplayContent {
  if (!check(input)) throw new Error(`Invalid screenplay schema: ${JSON.stringify(check.errors)}`);
  const content = input as unknown as ScreenplayContent;
  const ids = new Set<string>();
  const unique = (id: string) => { if (ids.has(id)) throw new Error(`Duplicate entity ID: ${id}`); ids.add(id); };
  const cast = new Set(content.characters.map((c) => c.id));
  for (const c of content.characters) unique(c.id);
  for (const beat of content.beats) {
    unique(beat.id);
    if (beat.characterIds.some((id) => !cast.has(id))) throw new Error(`Unknown beat character: ${beat.id}`);
  }
  for (const [index, scene] of content.scenes.entries()) {
    unique(scene.id);
    if (scene.order !== index + 1) throw new Error('Scene order must be consecutive and match array order');
    if (scene.characterIds.some((id) => !cast.has(id))) throw new Error(`Unknown scene character: ${scene.id}`);
    for (const line of scene.dialogue) if (!scene.characterIds.includes(line.characterId)) throw new Error(`Unknown scene speaker: ${line.characterId}`);
  }
  if (['DRAFT', 'REVISION', 'HANDOFF'].includes(content.stage) && !content.scenes.length) throw new Error('A draft or handoff requires scenes');
}
export function reviseScreenplay(current: ScreenplayDocument, candidate: unknown, options: ScreenplayRevisionOptions): ScreenplayDocument {
  if (options.expectedVersion !== current.version) throw new Error('VERSION_CONFLICT');
  if (!options.reason.trim()) throw new Error('A change reason is required');
  validateScreenplay(candidate);
  if (!options.allowLockedChanges) {
    for (const field of [...current.content.lockedFields, 'lockedFields', 'confirmedConstraints'] as const) {
      if (!equal(current.content[field], candidate[field])) throw new Error(`LOCK_CONFLICT: ${field}`);
    }
  }
  if (options.scope === 'dialogue') {
    const allowed = new Set(options.sceneIds ?? []);
    if (!allowed.size || [...allowed].some((id) => !current.content.scenes.some((s) => s.id === id))) throw new Error('Dialogue scope requires known scene IDs');
    const strip = (content: ScreenplayContent) => ({ ...content,
      scenes: content.scenes.map((scene) => allowed.has(scene.id) ? { ...scene, dialogue: [] } : scene) });
    if (!equal(strip(current.content), strip(candidate))) throw new Error('SCOPE_CONFLICT: only selected dialogue may change');
  }
  return { schemaVersion: '1.0.0', projectId: current.projectId, version: current.version + 1, parentVersion: current.version,
    createdAt: new Date().toISOString(), changeReason: options.reason, content: structuredClone(candidate) };
}
function equal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every((k) =>
      Object.hasOwn(b, k) && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

export function renderScreenplay(document: ScreenplayDocument): string {
  const c = document.content; const names = new Map(c.characters.map((p) => [p.id, p.name]));
  return [`# ${c.title}`, '', `版本 ${document.version} · ${c.format} · 目标 ${c.targetMinutes} 分钟 · ${c.stage}`,
    '', '本文件从权威 JSON 导出；修改需生成候选并通过版本工具保存。', '', '## 故事', c.premise,
    '', '## 已定约束', ...c.confirmedConstraints.map((v) => `- ${v}`), '', '## 剧本',
    ...c.scenes.flatMap((s) => [`### ${s.order}. ${s.heading}（${s.id}）`, '', s.action, '',
      ...s.dialogue.map((line) => `${names.get(line.characterId)}：${line.text}`), '']),
    '## 未决事项', ...c.openQuestions.map((v) => `- ${v}`), '', `下一步：${c.nextStep}`, ''].join('\n');
}
