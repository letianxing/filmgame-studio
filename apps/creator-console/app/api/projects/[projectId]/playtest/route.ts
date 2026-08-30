import { NextResponse } from 'next/server';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  createPlaytestRoom,
  getLatestProductionRun,
  getStoryVersion,
  listPlaytestRooms,
  listPlaytestReports,
  savePlaytestReport,
} from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  return NextResponse.json({
    rooms: await listPlaytestRooms(projectId, user.userId),
    reports: await listPlaytestReports(projectId, user.userId),
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const storyVersion = await getStoryVersion(projectId, user.userId);
  if (!storyVersion) return NextResponse.json({ error: 'STORY_NOT_READY' }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { maxTransitions?: unknown };
  const maxTransitions =
    typeof body.maxTransitions === 'number' && Number.isInteger(body.maxTransitions)
      ? Math.max(1, Math.min(body.maxTransitions, 10_000))
      : 256;
  const baseUrl = process.env.ORCHESTRATOR_BASE_URL?.replace(/\/$/u, '');
  if (!baseUrl) return NextResponse.json({ error: 'ORCHESTRATOR_NOT_CONFIGURED' }, { status: 503 });
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/playtests/bot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.ORCHESTRATOR_API_TOKEN
          ? { authorization: `Bearer ${process.env.ORCHESTRATOR_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ story: storyVersion.story, maxTransitions }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ error: 'ORCHESTRATOR_UNAVAILABLE' }, { status: 503 });
  }
  const payload = (await response.json().catch(() => null)) as { report?: unknown; error?: string } | null;
  if (!response.ok || !payload?.report) {
    return NextResponse.json(
      { error: payload?.error ?? 'BOT_PLAYTEST_FAILED', statusCode: response.status },
      { status: 502 },
    );
  }
  const saved = await savePlaytestReport({
    projectId,
    ownerUserId: user.userId,
    storyVersion: storyVersion.version,
    report: payload.report,
  });
  return NextResponse.json({ ...saved, report: payload.report });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const run = await getLatestProductionRun(projectId, user.userId);
  if (!run || run.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: 'RUNTIME_PACKAGE_NOT_READY', productionStatus: run?.status ?? null },
      { status: 409 },
    );
  }
  const baseUrl = process.env.COLYSEUS_HTTP_URL?.replace(/\/$/u, '');
  if (!baseUrl) return NextResponse.json({ error: 'COLYSEUS_NOT_CONFIGURED' }, { status: 503 });
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/matchmake/create/story`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, runtimeVersion: run.production_version }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: 'COLYSEUS_UNAVAILABLE' }, { status: 503 });
  }
  const payload = (await response.json().catch(() => null)) as {
    room?: { roomId?: string };
    roomId?: string;
  } | null;
  const roomId = payload?.room?.roomId ?? payload?.roomId;
  if (!response.ok || !roomId) {
    return NextResponse.json(
      { error: 'ROOM_CREATION_FAILED', statusCode: response.status },
      { status: 502 },
    );
  }
  const room = await createPlaytestRoom({
    projectId,
    ownerUserId: user.userId,
    runtimeVersion: run.production_version,
    colyseusRoomId: roomId,
  });
  return NextResponse.json({ room, colyseusRoomId: roomId }, { status: 201 });
}
