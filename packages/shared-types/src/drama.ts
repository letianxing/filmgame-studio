/** Linear animation authoring contract; independent of multiplayer runtime state. */
export interface DramaCharacter {
  id: string;
  name: string;
  appearance: string;
  voiceId: string;
  referenceImageAssetId: string;
  voiceReferenceAssetId: string;
  referenceTranscript: string;
  rightsConfirmed: boolean;
}
export interface DramaShot {
  /** Composed, approved shot frame; distinct from a character turnaround sheet. */
  firstFrameAssetId?: string;
  id: string;
  description: string;
  camera: string;
  durationSeconds: number;
  characterIds: string[];
  dialogue: Array<{ characterId: string; text: string }>;
}
export interface DramaContent {
  title: string;
  visualStyle: string;
  aspectRatio: '16:9' | '9:16';
  characters: DramaCharacter[];
  episodes: Array<{ id: string; title: string; shots: DramaShot[] }>;
}
export interface DramaDocument extends DramaContent {
  schemaVersion: '1.0.0';
  projectId: string;
  version: number;
  parentVersion: number | null;
}

export interface DramaAsset { id: string; mimeType: string; sizeBytes: number; sha256: string }
export type DramaVideoBackend = 'WAN' | 'SEEDANCE';
export interface DramaRender {
  videoBackend?: DramaVideoBackend;
  musicPrompt?: string;
  id: string; version: number; mode: 'VIDEO' | 'STORYBOARD'; status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  completed: number; total: number; message: string;
  shots: Record<string, { hash: string; video: string; subtitle: string; duration: number }>;
  episodes: Array<{ id: string; title: string; video: string; subtitle: string; duration: number; burnedSubtitles?: boolean }>;
}
export interface DramaRecord {
  generations?: Array<{ assetId: string; provider: string; model?: string; requestId: string;
    inputHash: string; createdAt: string; usage: Array<{ unit: string; input: number; output: number }> }>;
  id: string; ownerId: string; idea: string; createdAt: string; updatedAt: string;
  status: 'GENERATING' | 'READY' | 'REVISING' | 'FAILED'; error?: string;
  document?: DramaDocument; proposal?: { baseVersion: number; content: DramaContent };
  history: DramaDocument[]; assets: Record<string, DramaAsset>; renders: DramaRender[];
}
