-- 0011_schedules.sql

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  next_run INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  retry_policy TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shutdown_logs (
  id TEXT PRIMARY KEY,
  initiated_by TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
