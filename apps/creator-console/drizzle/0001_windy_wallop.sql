CREATE TABLE `production_orchestrations` (
	`run_id` text PRIMARY KEY NOT NULL,
	`orchestrator_job_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `production_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
