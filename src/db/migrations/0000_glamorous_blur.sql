CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`repo_url` text NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`deploy_path` text NOT NULL,
	`docker_compose` integer DEFAULT false NOT NULL,
	`nginx_enabled` integer DEFAULT false NOT NULL,
	`domain` text,
	`db_enabled` integer DEFAULT false NOT NULL,
	`db_name` text,
	`api_key_hash` text NOT NULL,
	`api_key_prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_name_unique` ON `apps` (`name`);--> statement-breakpoint
CREATE TABLE `deployment_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`deployment_id` text NOT NULL,
	`step_name` text NOT NULL,
	`step_order` integer NOT NULL,
	`snapshot_data` text NOT NULL,
	`reversible` integer NOT NULL,
	`reversed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`triggered_by` text NOT NULL,
	`git_commit_before` text,
	`git_commit_after` text,
	`error_message` text,
	`current_step` text,
	`completed_steps` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `env_files` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`deployment_id` text,
	`encrypted_content` text NOT NULL,
	`content_checksum` text NOT NULL,
	`iv` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE no action
);
