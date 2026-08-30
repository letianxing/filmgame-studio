import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    title: text('title').notNull(),
    idea: text('idea').notNull(),
    status: text('status').notNull(),
    currentStoryVersion: integer('current_story_version').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_projects_owner_updated').on(table.ownerUserId, table.updatedAt)],
);

export const storyVersions = sqliteTable(
  'story_versions',
  {
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    parentVersion: integer('parent_version'),
    commandId: text('command_id'),
    storyJson: text('story_json').notNull(),
    validationJson: text('validation_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.version] }),
    index('idx_story_versions_project_created').on(table.projectId, table.createdAt),
  ],
);

export const authoringCommands = sqliteTable(
  'authoring_commands',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').notNull(),
    baseStoryVersion: integer('base_story_version').notNull(),
    commandText: text('command_text').notNull(),
    status: text('status').notNull(),
    intentJson: text('intent_json'),
    patchJson: text('patch_json'),
    dependencyJson: text('dependency_json'),
    validationJson: text('validation_json'),
    createdAt: text('created_at').notNull(),
    appliedAt: text('applied_at'),
  },
  (table) => [index('idx_authoring_commands_project_created').on(table.projectId, table.createdAt)],
);

export const productionRuns = sqliteTable(
  'production_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    storyVersion: integer('story_version').notNull(),
    productionVersion: integer('production_version').notNull(),
    status: text('status').notNull(),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    actualCostCents: integer('actual_cost_cents').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_production_runs_project_version').on(table.projectId, table.productionVersion),
  ],
);

export const productionOrchestrations = sqliteTable('production_orchestrations', {
  runId: text('run_id')
    .primaryKey()
    .references(() => productionRuns.id, { onDelete: 'cascade' }),
  orchestratorJobId: text('orchestrator_job_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const productionJobs = sqliteTable(
  'production_jobs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => productionRuns.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    entityId: text('entity_id'),
    status: text('status').notNull(),
    dependenciesJson: text('dependencies_json').notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    inputJson: text('input_json'),
    outputJson: text('output_json'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_production_jobs_run_status').on(table.runId, table.status)],
);

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: text('status').notNull(),
    r2Key: text('r2_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    metadataJson: text('metadata_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_assets_project_type_status').on(table.projectId, table.type, table.status)],
);

export const playtestRooms = sqliteTable(
  'playtest_rooms',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    runtimeVersion: integer('runtime_version').notNull(),
    status: text('status').notNull(),
    roomCode: text('room_code').notNull(),
    createdAt: text('created_at').notNull(),
    endedAt: text('ended_at'),
  },
  (table) => [
    uniqueIndex('idx_playtest_rooms_code').on(table.roomCode),
    index('idx_playtest_rooms_project_status').on(table.projectId, table.status),
  ],
);

export const playtestReports = sqliteTable(
  'playtest_reports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    storyVersion: integer('story_version').notNull(),
    reportJson: text('report_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_playtest_reports_project_created').on(table.projectId, table.createdAt)],
);
