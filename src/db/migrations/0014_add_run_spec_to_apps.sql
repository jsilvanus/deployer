-- 0014_add_run_spec_to_apps.sql

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

-- Add column as nullable to avoid full-table rewrite on large SQLite DBs.
ALTER TABLE apps ADD COLUMN run_spec TEXT;

COMMIT;
PRAGMA foreign_keys=on;
