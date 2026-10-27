import type { DramaContent, DramaVideoBackend } from '@filmgame/shared-types';

export function parseVideoBackend(value: unknown): DramaVideoBackend {
  if (value !== 'WAN' && value !== 'SEEDANCE') throw new Error('请明确选择视频引擎：WAN 或 SEEDANCE');
  return value;
}

export function assertWanShots(document: DramaContent): void {
  for (const shot of document.episodes.flatMap((e) => e.shots)) {
    if (!shot.firstFrameAssetId) throw new Error(`${shot.id}：Wan 需要已确认的镜头首帧，请勿用多人概念板代替场景首帧`);
    if (shot.durationSeconds > 4) throw new Error(`${shot.id}：本机 Wan 安全档每镜最多 4 秒，请先拆镜`);
  }
}
