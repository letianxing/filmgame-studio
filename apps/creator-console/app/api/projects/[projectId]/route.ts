import { NextResponse } from 'next/server';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getProject, getStoryVersion } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const project = await getProject(projectId, user.userId);
  if (!project) return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  const storyVersion = await getStoryVersion(projectId, user.userId);
  return NextResponse.json({ project, storyVersion });
}
