-- 0014_add_run_spec_to_apps.sql

PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

ALTER TABLE apps ADD COLUMN run_spec TEXT NOT NULL DEFAULT '{}';

COMMIT;
PRAGMA foreign_keys=on;
