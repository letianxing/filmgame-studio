import { StudioPageShell } from '@/components/studio-page-shell';
import { DramaTutorials } from '@/components/drama-tutorials';
export default function LearnPage() {
  return <StudioPageShell active="learn" eyebrow="Learn / Create" title="漫剧制作学习室"
    description="从第一句创意到整集成片，在每一步找到对应教程。" status="B 站教程 · 原站播放">
    <DramaTutorials />
  </StudioPageShell>;
}
