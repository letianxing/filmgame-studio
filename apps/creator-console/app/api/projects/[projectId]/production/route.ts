import { NextResponse } from 'next/server';

import { getChatGPTUser } from '@/app/chatgpt-auth';
import {
  applyProductionPlan,
  createProductionRun,
  getLatestProductionRun,
  getNextProductionVersion,
  getProject,
  getStoryVersion,
  listProductionJobs,
  markProductionRunStatus,
  syncProductionExecution,
} from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const run = await getLatestProductionRun(projectId, user.userId);
  if (!run) return NextResponse.json({ run: null, jobs: [] });
  const jobs = await listProductionJobs(run.id, projectId, user.userId);
  return NextResponse.json({ run, jobs });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const project = await getProject(projectId, user.userId);
  if (!project) return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
  const storyVersion = await getStoryVersion(projectId, user.userId);
  if (!storyVersion) return NextResponse.json({ error: 'STORY_NOT_READY' }, { status: 409 });
  const existing = await getLatestProductionRun(projectId, user.userId);
  if (
    existing &&
    existing.story_version === storyVersion.version &&
    ['PLANNING', 'PLANNED', 'RUNNING'].includes(existing.status)
  ) {
    return NextResponse.json({ run: existing, reused: true }, { status: 200 });
  }
  const productionVersion = await getNextProductionVersion(projectId, user.userId);
  const response = await orchestratorFetch('/v1/production/plans', {
    method: 'POST',
    body: JSON.stringify({ story: storyVersion.story, productionVersion }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: 'PRODUCTION_PLANNING_REJECTED', statusCode: response.status, detail },
      { status: 502 },
    );
  }
  const payload = (await response.json()) as { job?: { id?: string } };
  if (!payload.job?.id) {
    return NextResponse.json({ error: 'INVALID_ORCHESTRATOR_RESPONSE' }, { status: 502 });
  }
  const run = await createProductionRun({
    projectId,
    ownerUserId: user.userId,
    storyVersion: storyVersion.version,
    productionVersion,
    orchestratorJobId: payload.job.id,
  });
  return NextResponse.json({ run }, { status: 202 });
}

export async function PUT(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const run = await getLatestProductionRun(projectId, user.userId);
  if (!run) return NextResponse.json({ error: 'PRODUCTION_RUN_NOT_FOUND' }, { status: 404 });
  const response = await orchestratorFetch(
    `/v1/production/plans/${encodeURIComponent(run.orchestrator_job_id)}`,
  );
  if (!response.ok) {
    return NextResponse.json({ error: 'ORCHESTRATOR_ERROR', statusCode: response.status }, { status: 502 });
  }
  const payload = (await response.json()) as ProductionPlanPayload;
  const job = payload.job;
  if (!job) return NextResponse.json({ error: 'INVALID_ORCHESTRATOR_RESPONSE' }, { status: 502 });
  if ((job.status === 'QUEUED' || job.status === 'RUNNING') && run.status === 'PLANNING') {
    return NextResponse.json({ status: job.status, run });
  }
  if (job.status !== 'SUCCEEDED' || !job.result?.jobs) {
    return NextResponse.json({ status: 'FAILED', error: job.error ?? 'Production planning failed' });
  }
  if (run.status === 'PLANNING') {
    await applyProductionPlan({
      projectId,
      ownerUserId: user.userId,
      runId: run.id,
      jobs: job.result.jobs,
    });
  }
  if (job.executionStatus) {
    const runStatus =
      job.executionStatus === 'SUCCEEDED'
        ? 'COMPLETED'
        : job.executionStatus === 'FAILED'
          ? 'FAILED'
          : 'RUNNING';
    await syncProductionExecution({
      projectId,
      ownerUserId: user.userId,
      runId: run.id,
      status: runStatus,
      jobs: job.result.jobs,
    });
  }
  const updated = await getLatestProductionRun(projectId, user.userId);
  return NextResponse.json({
    status: 'PLANNED',
    run: updated,
    jobs: await listProductionJobs(run.id, projectId, user.userId),
  });
}

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { projectId } = await context.params;
  const run = await getLatestProductionRun(projectId, user.userId);
  if (!run) return NextResponse.json({ error: 'PRODUCTION_RUN_NOT_FOUND' }, { status: 404 });
  if (run.status !== 'PLANNED' && run.status !== 'FAILED') {
    return NextResponse.json({ error: 'PRODUCTION_RUN_NOT_READY', status: run.status }, { status: 409 });
  }
  const response = await orchestratorFetch(
    `/v1/production/plans/${encodeURIComponent(run.orchestrator_job_id)}/run`,
    { method: 'POST', body: '{}' },
  );
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    return NextResponse.json(
      { error: 'PRODUCTION_EXECUTION_REJECTED', statusCode: response.status, detail: payload },
      { status: response.status === 409 ? 409 : 502 },
    );
  }
  await markProductionRunStatus({
    projectId,
    ownerUserId: user.userId,
    runId: run.id,
    status: 'RUNNING',
  });
  return NextResponse.json({ status: 'RUNNING', runId: run.id }, { status: 202 });
}

async function orchestratorFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
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

interface ProductionPlanPayload {
  job?: {
    status?: string;
    error?: string;
    executionStatus?: string;
    executionSummary?: unknown;
    result?: { jobs?: ProductionJobPayload[] };
  };
}

interface ProductionJobPayload {
  id: string;
  type: string;
  entityId?: string;
  status: string;
  dependencies: string[];
  attempt: number;
  maxAttempts: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}
