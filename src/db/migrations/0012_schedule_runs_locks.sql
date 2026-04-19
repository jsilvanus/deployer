-- 0012_schedule_runs_locks.sql

ALTER TABLE schedules RENAME TO _schedules_old;

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES apps(id),
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

INSERT INTO schedules SELECT * FROM _schedules_old;
DROP TABLE _schedules_old;

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  details TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_locks (
  schedule_id TEXT PRIMARY KEY REFERENCES schedules(id),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
