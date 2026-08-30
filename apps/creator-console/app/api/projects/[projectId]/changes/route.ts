import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  applyStoredChangeProposal,
  createChangeProposal,
  getStoryVersion,
  rollbackStoryVersion,
} from '@/lib/database';

const proposalSchema = z.object({ text: z.string().trim().min(2).max(12_000) });
const applySchema = z.object({ commandId: z.string().startsWith('command-') });

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const parsed = proposalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_COMMAND' }, { status: 400 });
  const current = await getStoryVersion(projectId, user.userId);
  if (!current) return NextResponse.json({ error: 'STORY_NOT_READY' }, { status: 409 });
  const response = await orchestratorFetch('/v1/story/changes/proposals', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      baseStoryVersion: current.version,
      story: current.story,
      text: parsed.data.text,
    }),
  });
  if (!response.ok) {
    return NextResponse.json({ error: 'PROPOSAL_REJECTED', statusCode: response.status }, { status: 502 });
  }
  const payload = (await response.json()) as { proposal?: unknown };
  if (!payload.proposal) {
    return NextResponse.json({ error: 'INVALID_ORCHESTRATOR_RESPONSE' }, { status: 502 });
  }
  const command = await createChangeProposal({
    projectId,
    ownerUserId: user.userId,
    baseStoryVersion: current.version,
    text: parsed.data.text,
    proposal: payload.proposal,
  });
  return NextResponse.json({ ...command, proposal: payload.proposal });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => null)) as { targetVersion?: unknown } | null;
  if (!body || !Number.isInteger(body.targetVersion)) {
    return NextResponse.json({ error: 'INVALID_TARGET_VERSION' }, { status: 400 });
  }
  try {
    const rolledBack = await rollbackStoryVersion({
      projectId,
      ownerUserId: user.userId,
      targetVersion: body.targetVersion as number,
    });
    return NextResponse.json({ status: 'ROLLED_BACK', ...rolledBack });
  } catch (cause) {
    return NextResponse.json(
      { error: 'ROLLBACK_REJECTED', message: cause instanceof Error ? cause.message : 'Rollback failed' },
      { status: 409 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const parsed = applySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_COMMAND' }, { status: 400 });
  try {
    const applied = await applyStoredChangeProposal({
      projectId,
      ownerUserId: user.userId,
      commandId: parsed.data.commandId,
    });
    return NextResponse.json({ status: 'APPLIED', ...applied });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unable to apply proposal';
    return NextResponse.json(
      { error: message.includes('conflict') ? 'VERSION_CONFLICT' : 'PROPOSAL_NOT_APPLICABLE', message },
      { status: 409 },
    );
  }
}

async function orchestratorFetch(pathname: string, init: RequestInit): Promise<Response> {
  const baseUrl = process.env.ORCHESTRATOR_BASE_URL?.replace(/\/$/u, '');
  if (!baseUrl) throw new Error('ORCHESTRATOR_BASE_URL is not configured');
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (process.env.ORCHESTRATOR_API_TOKEN) {
    headers.set('authorization', `Bearer ${process.env.ORCHESTRATOR_API_TOKEN}`);
  }
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
}
