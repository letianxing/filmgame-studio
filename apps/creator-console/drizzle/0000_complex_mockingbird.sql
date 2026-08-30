CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assets_project_type_status` ON `assets` (`project_id`,`type`,`status`);--> statement-breakpoint
CREATE TABLE `authoring_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`base_story_version` integer NOT NULL,
	`command_text` text NOT NULL,
	`status` text NOT NULL,
	`intent_json` text,
	`patch_json` text,
	`dependency_json` text,
	`validation_json` text,
	`created_at` text NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_authoring_commands_project_created` ON `authoring_commands` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `playtest_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`runtime_version` integer NOT NULL,
	`status` text NOT NULL,
	`room_code` text NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_playtest_rooms_code` ON `playtest_rooms` (`room_code`);--> statement-breakpoint
CREATE INDEX `idx_playtest_rooms_project_status` ON `playtest_rooms` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `production_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_id` text,
	`status` text NOT NULL,
	`dependencies_json` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`input_json` text,
	`output_json` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `production_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_production_jobs_run_status` ON `production_jobs` (`run_id`,`status`);--> statement-breakpoint
CREATE TABLE `production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_version` integer NOT NULL,
	`production_version` integer NOT NULL,
	`status` text NOT NULL,
	`estimated_cost_cents` integer DEFAULT 0 NOT NULL,
	`actual_cost_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_production_runs_project_version` ON `production_runs` (`project_id`,`production_version`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`idea` text NOT NULL,
	`status` text NOT NULL,
	`current_story_version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner_updated` ON `projects` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `story_versions` (
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`parent_version` integer,
	`command_id` text,
	`story_json` text NOT NULL,
	`validation_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `version`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_story_versions_project_created` ON `story_versions` (`project_id`,`created_at`);