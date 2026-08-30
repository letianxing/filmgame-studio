import { env } from 'cloudflare:workers';

export interface ProjectRow {
  id: string;
  owner_user_id: string;
  title: string;
  idea: string;
  status: string;
  current_story_version: number;
  created_at: string;
  updated_at: string;
}

export interface AuthoringCommandRow {
  id: string;
  project_id: string;
  owner_user_id: string;
  base_story_version: number;
  command_text: string;
  status: string;
  created_at: string;
}

export interface DispatchedAuthoringCommandRow extends AuthoringCommandRow {
  intent_json: string;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    idea TEXT NOT NULL,
    status TEXT NOT NULL,
    current_story_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
    ON projects(owner_user_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS story_versions (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    parent_version INTEGER,
    command_id TEXT,
    story_json TEXT NOT NULL,
    validation_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_story_versions_project_created
    ON story_versions(project_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS authoring_commands (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL,
    base_story_version INTEGER NOT NULL,
    command_text TEXT NOT NULL,
    status TEXT NOT NULL,
    intent_json TEXT,
    patch_json TEXT,
    dependency_json TEXT,
    validation_json TEXT,
    created_at TEXT NOT NULL,
    applied_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_authoring_commands_project_created
    ON authoring_commands(project_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS production_runs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    story_version INTEGER NOT NULL,
    production_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    actual_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_production_runs_project_version
    ON production_runs(project_id, production_version)`,
  `CREATE TABLE IF NOT EXISTS production_orchestrations (
    run_id TEXT PRIMARY KEY NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    orchestrator_job_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS production_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    entity_id TEXT,
    status TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    input_json TEXT,
    output_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_production_jobs_run_status
    ON production_jobs(run_id, status)`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_assets_project_type_status
    ON assets(project_id, type, status)`,
  `CREATE TABLE IF NOT EXISTS playtest_rooms (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    runtime_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    room_code TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ended_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_playtest_rooms_code
    ON playtest_rooms(room_code)`,
  `CREATE INDEX IF NOT EXISTS idx_playtest_rooms_project_status
    ON playtest_rooms(project_id, status)`,
  `CREATE TABLE IF NOT EXISTS playtest_reports (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    story_version INTEGER NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playtest_reports_project_created
    ON playtest_reports(project_id, created_at)`,
] as const;

let initialization: Promise<void> | undefined;

export async function ensureDatabase(): Promise<D1Database> {
  initialization ??= env.DB
    .batch(schemaStatements.map((statement) => env.DB.prepare(statement)))
    .then(async () => {
      await env.DB.prepare('PRAGMA optimize').run();
    });
  await initialization;
  return env.DB;
}

export async function listProjects(ownerUserId: string): Promise<ProjectRow[]> {
  const database = await ensureDatabase();
  const result = await database
    .prepare(
      `SELECT id, owner_user_id, title, idea, status, current_story_version, created_at, updated_at
       FROM projects
       WHERE owner_user_id = ?
       ORDER BY updated_at DESC
       LIMIT 100`,
    )
    .bind(ownerUserId)
    .all<ProjectRow>();
  return result.results;
}

export async function getProject(
  projectId: string,
  ownerUserId: string,
): Promise<ProjectRow | null> {
  const database = await ensureDatabase();
  return database
    .prepare(
      `SELECT id, owner_user_id, title, idea, status, current_story_version, created_at, updated_at
       FROM projects
       WHERE id = ? AND owner_user_id = ?`,
    )
    .bind(projectId, ownerUserId)
    .first<ProjectRow>();
}

export async function createProjectAndInitialCommand(input: {
  ownerUserId: string;
  title: string;
  idea: string;
}): Promise<{ project: ProjectRow; command: AuthoringCommandRow }> {
  const database = await ensureDatabase();
  const now = new Date().toISOString();
  const projectId = `project-${crypto.randomUUID()}`;
  const commandId = `command-${crypto.randomUUID()}`;
  await database.batch([
    database
      .prepare(
        `INSERT INTO projects
          (id, owner_user_id, title, idea, status, current_story_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'GENERATING', 0, ?, ?)`,
      )
      .bind(projectId, input.ownerUserId, input.title, input.idea, now, now),
    database
      .prepare(
        `INSERT INTO authoring_commands
          (id, project_id, owner_user_id, base_story_version, command_text, status, created_at)
         VALUES (?, ?, ?, 0, ?, 'QUEUED', ?)`,
      )
      .bind(commandId, projectId, input.ownerUserId, input.idea, now),
  ]);

  return {
    project: {
      id: projectId,
      owner_user_id: input.ownerUserId,
      title: input.title,
      idea: input.idea,
      status: 'GENERATING',
      current_story_version: 0,
      created_at: now,
      updated_at: now,
    },
    command: {
      id: commandId,
      project_id: projectId,
      owner_user_id: input.ownerUserId,
      base_story_version: 0,
      command_text: input.idea,
      status: 'QUEUED',
      created_at: now,
    },
  };
}

export async function markCommandDispatched(input: {
  projectId: string;
  commandId: string;
  orchestratorJobId: string;
}): Promise<void> {
  const database = await ensureDatabase();
  const result = await database
    .prepare(
      `UPDATE authoring_commands
       SET status = 'RUNNING', intent_json = ?
       WHERE id = ? AND project_id = ? AND status = 'QUEUED'`,
    )
    .bind(
      JSON.stringify({ orchestratorJobId: input.orchestratorJobId }),
      input.commandId,
      input.projectId,
    )
    .run();
  if (result.meta.changes !== 1) throw new Error('Authoring command was not in QUEUED state');
}

export async function getRunningAuthoringCommand(
  projectId: string,
  ownerUserId: string,
): Promise<DispatchedAuthoringCommandRow | null> {
  const database = await ensureDatabase();
  return database
    .prepare(
      `SELECT id, project_id, owner_user_id, base_story_version, command_text, status,
              created_at, intent_json
       FROM authoring_commands
       WHERE project_id = ? AND owner_user_id = ? AND status = 'RUNNING'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(projectId, ownerUserId)
    .first<DispatchedAuthoringCommandRow>();
}

export async function applyGeneratedStory(input: {
  projectId: string;
  ownerUserId: string;
  commandId: string;
  story: unknown;
  validation: unknown;
}): Promise<{ version: number }> {
  const database = await ensureDatabase();
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const command = await database
    .prepare(
      `SELECT id, base_story_version, status
       FROM authoring_commands
       WHERE id = ? AND project_id = ? AND owner_user_id = ?`,
    )
    .bind(input.commandId, input.projectId, input.ownerUserId)
    .first<{ id: string; base_story_version: number; status: string }>();
  if (!command) throw new Error('Authoring command not found');
  if (command.status === 'APPLIED') return { version: project.current_story_version };
  if (command.status !== 'RUNNING') throw new Error(`Authoring command is ${command.status}`);
  if (project.current_story_version !== command.base_story_version) {
    throw new Error('Story version changed while generation was running');
  }
  const version = command.base_story_version + 1;
  const now = new Date().toISOString();
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO story_versions
          (project_id, version, parent_version, command_id, story_json, validation_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.projectId,
        version,
        command.base_story_version || null,
        input.commandId,
        JSON.stringify(input.story),
        JSON.stringify(input.validation),
        now,
      ),
    database
      .prepare(
        `UPDATE projects
         SET status = 'STORY_READY', current_story_version = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND current_story_version = ?`,
      )
      .bind(version, now, input.projectId, input.ownerUserId, command.base_story_version),
    database
      .prepare(
        `UPDATE authoring_commands
         SET status = 'APPLIED', validation_json = ?, applied_at = ?
         WHERE id = ? AND project_id = ? AND status = 'RUNNING'`,
      )
      .bind(JSON.stringify(input.validation), now, input.commandId, input.projectId),
  ]);
  if (results.some((result) => !result.success)) throw new Error('Unable to commit Story Version');
  return { version };
}

export async function markStoryGenerationFailed(input: {
  projectId: string;
  ownerUserId: string;
  commandId: string;
  error: string;
}): Promise<void> {
  const database = await ensureDatabase();
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `UPDATE authoring_commands
         SET status = 'FAILED', validation_json = ?
         WHERE id = ? AND project_id = ? AND owner_user_id = ? AND status = 'RUNNING'`,
      )
      .bind(JSON.stringify({ error: input.error }), input.commandId, input.projectId, input.ownerUserId),
    database
      .prepare(
        `UPDATE projects SET status = 'GENERATION_FAILED', updated_at = ?
         WHERE id = ? AND owner_user_id = ?`,
      )
      .bind(now, input.projectId, input.ownerUserId),
  ]);
}

export async function getStoryVersion(
  projectId: string,
  ownerUserId: string,
  version?: number,
): Promise<{ version: number; story: unknown; validation: unknown } | null> {
  const project = await getProject(projectId, ownerUserId);
  if (!project) return null;
  const requested = version ?? project.current_story_version;
  if (requested < 1) return null;
  const database = await ensureDatabase();
  const row = await database
    .prepare(
      `SELECT version, story_json, validation_json
       FROM story_versions WHERE project_id = ? AND version = ?`,
    )
    .bind(projectId, requested)
    .first<{ version: number; story_json: string; validation_json: string }>();
  return row
    ? {
        version: row.version,
        story: JSON.parse(row.story_json) as unknown,
        validation: JSON.parse(row.validation_json) as unknown,
      }
    : null;
}

export interface ProductionRunView {
  id: string;
  project_id: string;
  story_version: number;
  production_version: number;
  status: string;
  orchestrator_job_id: string;
  created_at: string;
  updated_at: string;
}

export async function getNextProductionVersion(
  projectId: string,
  ownerUserId: string,
): Promise<number> {
  const project = await getProject(projectId, ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  const row = await database
    .prepare(
      `SELECT COALESCE(MAX(production_version), 0) + 1 AS next_version
       FROM production_runs WHERE project_id = ?`,
    )
    .bind(projectId)
    .first<{ next_version: number }>();
  return row?.next_version ?? 1;
}

export async function createProductionRun(input: {
  projectId: string;
  ownerUserId: string;
  storyVersion: number;
  productionVersion: number;
  orchestratorJobId: string;
}): Promise<ProductionRunView> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  if (project.current_story_version !== input.storyVersion) {
    throw new Error('Production must use the current Story Version');
  }
  const database = await ensureDatabase();
  const id = `production-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO production_runs
          (id, project_id, story_version, production_version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'PLANNING', ?, ?)`,
      )
      .bind(id, input.projectId, input.storyVersion, input.productionVersion, now, now),
    database
      .prepare(
        `INSERT INTO production_orchestrations (run_id, orchestrator_job_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .bind(id, input.orchestratorJobId, now),
  ]);
  return {
    id,
    project_id: input.projectId,
    story_version: input.storyVersion,
    production_version: input.productionVersion,
    status: 'PLANNING',
    orchestrator_job_id: input.orchestratorJobId,
    created_at: now,
    updated_at: now,
  };
}

export async function getLatestProductionRun(
  projectId: string,
  ownerUserId: string,
): Promise<ProductionRunView | null> {
  const project = await getProject(projectId, ownerUserId);
  if (!project) return null;
  const database = await ensureDatabase();
  return database
    .prepare(
      `SELECT r.id, r.project_id, r.story_version, r.production_version, r.status,
              o.orchestrator_job_id, r.created_at, r.updated_at
       FROM production_runs r
       JOIN production_orchestrations o ON o.run_id = r.id
       WHERE r.project_id = ?
       ORDER BY r.production_version DESC
       LIMIT 1`,
    )
    .bind(projectId)
    .first<ProductionRunView>();
}

export async function applyProductionPlan(input: {
  projectId: string;
  ownerUserId: string;
  runId: string;
  jobs: Array<{
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
  }>;
}): Promise<void> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  const now = new Date().toISOString();
  const existing = await database
    .prepare('SELECT status FROM production_runs WHERE id = ? AND project_id = ?')
    .bind(input.runId, input.projectId)
    .first<{ status: string }>();
  if (!existing) throw new Error('Production run not found');
  if (existing.status === 'PLANNED') return;
  const statements = input.jobs.map((job) =>
    database
      .prepare(
        `INSERT INTO production_jobs
          (id, run_id, type, entity_id, status, dependencies_json, attempt, max_attempts,
           input_json, output_json, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `${input.runId}:${job.id}`,
        input.runId,
        job.type,
        job.entityId ?? null,
        job.status,
        JSON.stringify(job.dependencies),
        job.attempt,
        job.maxAttempts,
        job.input === undefined ? null : JSON.stringify(job.input),
        job.output === undefined ? null : JSON.stringify(job.output),
        job.error ?? null,
        now,
        now,
      ),
  );
  statements.push(
    database
      .prepare("UPDATE production_runs SET status = 'PLANNED', updated_at = ? WHERE id = ?")
      .bind(now, input.runId),
  );
  const results = await database.batch(statements);
  if (results.some((result) => !result.success)) throw new Error('Unable to persist Production Plan');
}

export async function listProductionJobs(
  runId: string,
  projectId: string,
  ownerUserId: string,
): Promise<Array<Record<string, unknown>>> {
  const project = await getProject(projectId, ownerUserId);
  if (!project) return [];
  const database = await ensureDatabase();
  const result = await database
    .prepare(
      `SELECT j.id, j.type, j.entity_id, j.status, j.dependencies_json, j.attempt,
              j.max_attempts, j.input_json, j.output_json, j.error
       FROM production_jobs j
       JOIN production_runs r ON r.id = j.run_id
       WHERE j.run_id = ? AND r.project_id = ?
       ORDER BY j.created_at, j.id`,
    )
    .bind(runId, projectId)
    .all<Record<string, unknown>>();
  return result.results;
}

export async function markProductionRunStatus(input: {
  projectId: string;
  ownerUserId: string;
  runId: string;
  status: string;
}): Promise<void> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  await database
    .prepare('UPDATE production_runs SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .bind(input.status, new Date().toISOString(), input.runId, input.projectId)
    .run();
}

export async function syncProductionExecution(input: {
  projectId: string;
  ownerUserId: string;
  runId: string;
  status: string;
  jobs: Array<{
    id: string;
    status: string;
    attempt: number;
    output?: unknown;
    error?: string;
  }>;
}): Promise<void> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  const now = new Date().toISOString();
  const statements = input.jobs.map((job) =>
    database
      .prepare(
        `UPDATE production_jobs
         SET status = ?, attempt = ?, output_json = ?, error = ?, updated_at = ?
         WHERE id = ? AND run_id = ?`,
      )
      .bind(
        job.status,
        job.attempt,
        job.output === undefined ? null : JSON.stringify(job.output),
        job.error ?? null,
        now,
        `${input.runId}:${job.id}`,
        input.runId,
      ),
  );
  statements.push(
    database
      .prepare('UPDATE production_runs SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?')
      .bind(input.status, now, input.runId, input.projectId),
  );
  const results = await database.batch(statements);
  if (results.some((result) => !result.success)) throw new Error('Unable to sync Production execution');
}

export async function createChangeProposal(input: {
  projectId: string;
  ownerUserId: string;
  baseStoryVersion: number;
  text: string;
  proposal: unknown;
}): Promise<{ commandId: string }> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  if (project.current_story_version !== input.baseStoryVersion) {
    throw new Error('Story Version conflict');
  }
  const database = await ensureDatabase();
  const commandId = `command-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const proposal = input.proposal as {
    intent?: unknown;
    patch?: unknown;
    dependencyImpact?: unknown;
    validation?: unknown;
  };
  await database
    .prepare(
      `INSERT INTO authoring_commands
        (id, project_id, owner_user_id, base_story_version, command_text, status,
         intent_json, patch_json, dependency_json, validation_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?)`,
    )
    .bind(
      commandId,
      input.projectId,
      input.ownerUserId,
      input.baseStoryVersion,
      input.text,
      JSON.stringify({ proposal, intent: proposal.intent }),
      JSON.stringify(proposal.patch ?? []),
      JSON.stringify(proposal.dependencyImpact ?? {}),
      JSON.stringify(proposal.validation ?? {}),
      now,
    )
    .run();
  return { commandId };
}

export async function applyStoredChangeProposal(input: {
  projectId: string;
  ownerUserId: string;
  commandId: string;
}): Promise<{ version: number; story: unknown }> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  const command = await database
    .prepare(
      `SELECT base_story_version, status, intent_json, validation_json
       FROM authoring_commands
       WHERE id = ? AND project_id = ? AND owner_user_id = ?`,
    )
    .bind(input.commandId, input.projectId, input.ownerUserId)
    .first<{
      base_story_version: number;
      status: string;
      intent_json: string;
      validation_json: string;
    }>();
  if (!command) throw new Error('Change proposal not found');
  if (command.status !== 'PROPOSED') throw new Error(`Change proposal is ${command.status}`);
  if (project.current_story_version !== command.base_story_version) {
    throw new Error('Story Version conflict');
  }
  const stored = JSON.parse(command.intent_json) as {
    proposal?: { status?: string; preview?: unknown };
  };
  if (stored.proposal?.status !== 'READY' || !stored.proposal.preview) {
    throw new Error(`Proposal is ${stored.proposal?.status ?? 'INVALID'}`);
  }
  const version = command.base_story_version + 1;
  const now = new Date().toISOString();
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO story_versions
          (project_id, version, parent_version, command_id, story_json, validation_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.projectId,
        version,
        command.base_story_version,
        input.commandId,
        JSON.stringify(stored.proposal.preview),
        command.validation_json,
        now,
      ),
    database
      .prepare(
        `UPDATE projects SET status = 'STORY_READY', current_story_version = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND current_story_version = ?`,
      )
      .bind(version, now, input.projectId, input.ownerUserId, command.base_story_version),
    database
      .prepare(
        `UPDATE authoring_commands SET status = 'APPLIED', applied_at = ?
         WHERE id = ? AND project_id = ? AND status = 'PROPOSED'`,
      )
      .bind(now, input.commandId, input.projectId),
  ]);
  if (results.some((result) => !result.success)) throw new Error('Unable to apply Story change');
  return { version, story: stored.proposal.preview };
}

export async function rollbackStoryVersion(input: {
  projectId: string;
  ownerUserId: string;
  targetVersion: number;
}): Promise<{ version: number; story: unknown }> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  if (input.targetVersion < 1 || input.targetVersion >= project.current_story_version) {
    throw new Error('Rollback target must be an earlier Story Version');
  }
  const target = await getStoryVersion(input.projectId, input.ownerUserId, input.targetVersion);
  if (!target) throw new Error('Rollback target not found');
  if (!target.story || typeof target.story !== 'object' || Array.isArray(target.story)) {
    throw new Error('Rollback target is invalid');
  }
  const version = project.current_story_version + 1;
  const story = {
    ...(target.story as Record<string, unknown>),
    storyVersion: version,
    parentStoryVersion: project.current_story_version,
    status: 'DRAFT',
    updatedAt: new Date().toISOString(),
  };
  const database = await ensureDatabase();
  const commandId = `command-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO authoring_commands
          (id, project_id, owner_user_id, base_story_version, command_text, status,
           intent_json, validation_json, created_at, applied_at)
         VALUES (?, ?, ?, ?, ?, 'APPLIED', ?, ?, ?, ?)`,
      )
      .bind(
        commandId,
        input.projectId,
        input.ownerUserId,
        project.current_story_version,
        `回滚到 Story v${input.targetVersion}`,
        JSON.stringify({ type: 'ROLLBACK', targetVersion: input.targetVersion }),
        JSON.stringify(target.validation),
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO story_versions
          (project_id, version, parent_version, command_id, story_json, validation_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.projectId,
        version,
        project.current_story_version,
        commandId,
        JSON.stringify(story),
        JSON.stringify(target.validation),
        now,
      ),
    database
      .prepare(
        `UPDATE projects SET current_story_version = ?, status = 'STORY_READY', updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND current_story_version = ?`,
      )
      .bind(version, now, input.projectId, input.ownerUserId, project.current_story_version),
  ]);
  if (results.some((result) => !result.success)) throw new Error('Unable to roll back Story Version');
  return { version, story };
}

export interface PlaytestRoomRow {
  id: string;
  project_id: string;
  runtime_version: number;
  status: string;
  room_code: string;
  created_at: string;
  ended_at: string | null;
}

export async function createPlaytestRoom(input: {
  projectId: string;
  ownerUserId: string;
  runtimeVersion: number;
  colyseusRoomId: string;
}): Promise<PlaytestRoomRow> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  const id = `playtest-${crypto.randomUUID()}`;
  const roomCode = input.colyseusRoomId;
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO playtest_rooms
        (id, project_id, runtime_version, status, room_code, created_at)
       VALUES (?, ?, ?, 'OPEN', ?, ?)`,
    )
    .bind(id, input.projectId, input.runtimeVersion, roomCode, now)
    .run();
  return {
    id,
    project_id: input.projectId,
    runtime_version: input.runtimeVersion,
    status: 'OPEN',
    room_code: roomCode,
    created_at: now,
    ended_at: null,
  };
}

export async function listPlaytestRooms(
  projectId: string,
  ownerUserId: string,
): Promise<PlaytestRoomRow[]> {
  const project = await getProject(projectId, ownerUserId);
  if (!project) return [];
  const database = await ensureDatabase();
  const result = await database
    .prepare(
      `SELECT id, project_id, runtime_version, status, room_code, created_at, ended_at
       FROM playtest_rooms WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(projectId)
    .all<PlaytestRoomRow>();
  return result.results;
}

export async function savePlaytestReport(input: {
  projectId: string;
  ownerUserId: string;
  storyVersion: number;
  report: unknown;
}): Promise<{ id: string; createdAt: string }> {
  const project = await getProject(input.projectId, input.ownerUserId);
  if (!project) throw new Error('Project not found');
  const database = await ensureDatabase();
  const id = `report-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO playtest_reports (id, project_id, story_version, report_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.projectId, input.storyVersion, JSON.stringify(input.report), createdAt)
    .run();
  return { id, createdAt };
}

export async function listPlaytestReports(
  projectId: string,
  ownerUserId: string,
): Promise<Array<{ id: string; storyVersion: number; report: unknown; createdAt: string }>> {
  const project = await getProject(projectId, ownerUserId);
  if (!project) return [];
  const database = await ensureDatabase();
  const result = await database
    .prepare(
      `SELECT id, story_version, report_json, created_at
       FROM playtest_reports WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(projectId)
    .all<{ id: string; story_version: number; report_json: string; created_at: string }>();
  return result.results.map((row) => ({
    id: row.id,
    storyVersion: row.story_version,
    report: JSON.parse(row.report_json) as unknown,
    createdAt: row.created_at,
  }));
}
