import AjvModule from 'ajv/dist/2020.js';
import schema from '../../../packages/story-schema/directed-drama.schema.json' with { type: 'json' };

export interface DirectedShot { id: string; start: number; end: number; size: string; camera: string; visual: string; purpose: string }
export interface DirectedSegment {
  id: string; durationSeconds: number; scene: string; referenceSegments: string[]; prompt: string;
  shots: DirectedShot[]; dialogue: Array<{ start: number; end: number; speaker: string; text: string }>;
}
export interface DirectedDramaPlan {
  schemaVersion: '1.0.0'; id: string; title: string; fictionNotice: string; aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p'; fps: number; style: string; referenceImages: string[]; segments: DirectedSegment[];
  edit: { audioLeadSeconds: number; targetLufs: number; title: string; endCard: string; subtitlePolicy: string };
  limits: { maxInitialRequests: number; maxOutputSeconds: number; automaticRegeneration: false };
  skillSources: { repository: string; ref: string; skills: string[] };
}
const Ajv = AjvModule as unknown as new (options: object) => { compile(schema: unknown): ((input: unknown) => boolean) & { errors?: unknown } };
const check = new Ajv({ allErrors: true, strict: false }).compile(schema);

export function validateDirectedDrama(input: unknown): asserts input is DirectedDramaPlan {
  if (!check(input)) throw new Error(`Invalid directed drama: ${JSON.stringify(check.errors)}`);
  const plan = input as DirectedDramaPlan;
  if (plan.segments.length > plan.limits.maxInitialRequests || plan.segments.reduce((s, g) => s + g.durationSeconds, 0) > plan.limits.maxOutputSeconds) throw new Error('Generation budget exceeded');
  const ids = new Set<string>(); const available = new Set<string>();
  for (const segment of plan.segments) {
    if (ids.has(segment.id)) throw new Error('Duplicate segment ID'); ids.add(segment.id);
    for (const match of segment.prompt.matchAll(/@图片(\d+)/g)) {
      if (Number(match[1]) < 1 || Number(match[1]) > plan.referenceImages.length) throw new Error('Prompt references a missing image');
    }
    for (const ref of segment.referenceSegments) if (!available.has(ref)) throw new Error('Reference must resolve to an earlier segment');
    let time = 0;
    for (const shot of segment.shots) {
      if (ids.has(shot.id)) throw new Error('Duplicate shot ID'); ids.add(shot.id);
      if (shot.start !== time || shot.end <= shot.start || shot.end > segment.durationSeconds) throw new Error('Shot timeline must be contiguous and bounded');
      time = shot.end;
    }
    if (time !== segment.durationSeconds) throw new Error('Shots must cover the segment');
    let speechEnd = 0;
    for (const line of segment.dialogue) {
      if (line.start < speechEnd || line.end <= line.start || line.end > segment.durationSeconds) throw new Error('Dialogue timing is invalid');
      if (segment.prompt.split(line.text).length !== 2) throw new Error('Each exact dialogue line must appear once in the prompt');
      speechEnd = line.end;
    }
    available.add(segment.id);
  }
}
