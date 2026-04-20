import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../src/db/client.js';
import Database from 'better-sqlite3';
import { appEnvVars } from '../src/db/schema.js';
import { AppEnvService } from '../src/services/app-env.service.js';
import { composeWriteStep } from '../src/core/steps/compose-write.step.js';
import { effectiveConfig } from '../src/config.js';

async function run() {
  const cwd = process.cwd();
  const tmp = join(cwd, '.tmp', 'phase3');
  mkdirSync(tmp, { recursive: true });
  const dbPath = join(tmp, 'phase3.db');

  // create sqlite file and table
  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_env_vars (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS app_env_vars_app_id_key_unique ON app_env_vars(app_id, key);
  `);
  sqlite.close();

  const db = getDb(dbPath);
  // Construct minimal config for the script — only envEncryptionKey is required here
  const config: any = { envEncryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' };
  const envSvc = new AppEnvService(db, config.envEncryptionKey);

  const appId = 'test-app-1';
  const composeContent = `version: '3.8'\nservices:\n  web:\n    image: alpine:3.18\n    command: ["/bin/sh", "-c", "echo hello"]\n`;

  await envSvc.set(appId, '_COMPOSE_CONTENT', composeContent);

  const ctx: any = {
    app: { id: appId, deployPath: tmp },
    db,
    config,
    logger: console,
  };

  // ensure no compose file exists
  const composePath = join(tmp, 'docker-compose.yml');
  if (existsSync(composePath)) {
    // remove
    writeFileSync(composePath, '');
  }

  // run step
  await composeWriteStep.execute(ctx as any);

  const written = readFileSync(composePath, 'utf8');
  if (written.trim() === composeContent.trim()) {
    console.log('compose-write verification: OK');
    process.exit(0);
  }
  console.error('compose-write verification: FAILED');
  process.exit(2);
}

run().catch((e) => { console.error(e); process.exit(2); });
