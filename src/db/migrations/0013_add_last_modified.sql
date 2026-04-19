-- Add last_modified column to apps for cache validation and UI sync
PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

ALTER TABLE apps ADD COLUMN last_modified INTEGER DEFAULT (strftime('%s','now')) NOT NULL;

COMMIT;
PRAGMA foreign_keys=on;
