import { loadConfig } from './config.js';
import { getDb } from './db/client.js';
import { createServer } from './api/server.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const db = getDb(config.dbPath);

  // Run pending migrations on startup
  migrate(db, {
    migrationsFolder: path.join(__dirname, 'db/migrations'),
  });

  const server = await createServer(config, db);

  await server.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
