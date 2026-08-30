CREATE TABLE `playtest_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`story_version` integer NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_playtest_reports_project_created` ON `playtest_reports` (`project_id`,`created_at`);