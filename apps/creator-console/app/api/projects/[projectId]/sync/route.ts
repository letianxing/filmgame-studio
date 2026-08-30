import { NextResponse } from 'next/server';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  applyGeneratedStory,
  getProject,
  getRunningAuthoringCommand,
  getStoryVersion,
  markStoryGenerationFailed,
} from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const project = await getProject(projectId, user.userId);
  if (!project) return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  const command = await getRunningAuthoringCommand(projectId, user.userId);
  if (!command) {
    const current = await getStoryVersion(projectId, user.userId);
    return NextResponse.json({
      status: current ? 'STORY_READY' : project.status,
      project,
      ...(current ? { storyVersion: current } : {}),
    });
  }
  const intent = parseIntent(command.intent_json);
  const baseUrl = process.env.ORCHESTRATOR_BASE_URL?.replace(/\/$/u, '');
  if (!baseUrl) {
    return NextResponse.json({ error: 'ORCHESTRATOR_NOT_CONFIGURED' }, { status: 503 });
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/story/generations/${encodeURIComponent(intent.jobId)}`, {
      headers: process.env.ORCHESTRATOR_API_TOKEN
        ? { authorization: `Bearer ${process.env.ORCHESTRATOR_API_TOKEN}` }
        : {},
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'ORCHESTRATOR_UNAVAILABLE' }, { status: 503 });
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: 'ORCHESTRATOR_ERROR', statusCode: response.status },
      { status: 502 },
    );
  }
  const payload = (await response.json()) as StoryJobPayload;
  const job = payload.job;
  if (!job) return NextResponse.json({ error: 'INVALID_ORCHESTRATOR_RESPONSE' }, { status: 502 });
  if (job.status === 'QUEUED' || job.status === 'RUNNING') {
    return NextResponse.json({ status: job.status, jobId: intent.jobId });
  }
  if (job.status === 'FAILED') {
    await markStoryGenerationFailed({
      projectId,
      ownerUserId: user.userId,
      commandId: command.id,
      error: job.error ?? 'Story generation failed',
    });
    return NextResponse.json({ status: 'FAILED', error: job.error ?? null });
  }
  if (job.status !== 'SUCCEEDED' || !job.result?.story || !job.result.validation) {
    return NextResponse.json({ error: 'INVALID_ORCHESTRATOR_RESULT' }, { status: 502 });
  }
  const applied = await applyGeneratedStory({
    projectId,
    ownerUserId: user.userId,
    commandId: command.id,
    story: job.result.story,
    validation: job.result.validation,
  });
  return NextResponse.json({
    status: 'STORY_READY',
    version: applied.version,
    story: job.result.story,
    validation: job.result.validation,
  });
}

function parseIntent(value: string): { jobId: string } {
  const parsed = JSON.parse(value) as { orchestratorJobId?: unknown };
  if (
    typeof parsed.orchestratorJobId !== 'string' ||
    !parsed.orchestratorJobId.startsWith('story-generation-')
  ) {
    throw new Error('Authoring command has no valid orchestrator job');
  }
  return { jobId: parsed.orchestratorJobId };
}

interface StoryJobPayload {
  job?: {
    status?: string;
    error?: string;
    result?: { story?: unknown; validation?: unknown };
  };
}
