import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createProjectAndInitialCommand,
  listProjects,
  markCommandDispatched,
} from '@/lib/database';

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  idea: z.string().trim().min(40).max(12_000),
});

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({ projects: await listProjects(user.userId) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const parsed = createProjectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_PROJECT', issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const created = await createProjectAndInitialCommand({
    ownerUserId: user.userId,
    title: parsed.data.title,
    idea: parsed.data.idea,
  });
  const orchestration = await dispatchStoryGeneration({
    projectId: created.project.id,
    commandId: created.command.id,
    idea: parsed.data.idea,
  });
  return NextResponse.json({ ...created, orchestration }, { status: 202 });
}

async function dispatchStoryGeneration(input: {
  projectId: string;
  commandId: string;
  idea: string;
}): Promise<{ status: 'NOT_CONFIGURED' | 'DISPATCHED' | 'UNAVAILABLE'; jobId?: string }> {
  const baseUrl = process.env.ORCHESTRATOR_BASE_URL?.replace(/\/$/u, '');
  if (!baseUrl) return { status: 'NOT_CONFIGURED' };
  try {
    const response = await fetch(`${baseUrl}/v1/story/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.ORCHESTRATOR_API_TOKEN
          ? { authorization: `Bearer ${process.env.ORCHESTRATOR_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ projectId: input.projectId, idea: input.idea }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { status: 'UNAVAILABLE' };
    const payload = (await response.json()) as { job?: { id?: string } };
    const jobId = payload.job?.id;
    if (!jobId) return { status: 'UNAVAILABLE' };
    await markCommandDispatched({
      projectId: input.projectId,
      commandId: input.commandId,
      orchestratorJobId: jobId,
    });
    return { status: 'DISPATCHED', jobId };
  } catch {
    return { status: 'UNAVAILABLE' };
  }
}
