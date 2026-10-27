import { StudioPageShell } from '@/components/studio-page-shell';
import { DramaStudio } from '@/components/drama-studio';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { dramaTutorials } from '@/lib/drama-tutorials';

export const dynamic = 'force-dynamic';
export default async function DramaPage({ searchParams }: { searchParams: Promise<{ projectId?: string; lesson?: string }> }) {
  const user = await getChatGPTUser();
  const params = await searchParams;
  return <StudioPageShell active="drama" eyebrow="Comic Drama Studio" title="把脑海里的故事，做成一集漫剧"
    description="描述创意、定下角色、调整分镜，再生成视频与配音。所有修改保留版本，成片可以直接预览和下载。" status="线性漫剧 · 独立创作">
    <DramaStudio signedIn={Boolean(user)} signInPath={chatGPTSignInPath('/drama')}
      initialId={params.projectId} initialPrompt={dramaTutorials.find((t) => t.id === params.lesson)?.prompt} />
  </StudioPageShell>;
}
