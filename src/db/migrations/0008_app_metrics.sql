CREATE TABLE `app_metrics` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL REFERENCES `apps`(`id`) ON DELETE CASCADE,
  `timestamp` integer NOT NULL,
  `status` text NOT NULL,
  `cpu` real,
  `memory_mb` real
);
CREATE INDEX `app_metrics_app_id_timestamp` ON `app_metrics` (`app_id`, `timestamp`);
