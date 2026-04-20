import { it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { getDb } from '../src/db/client.js';
import { createServer } from '../src/api/server.js';
import { requestLogs } from '../src/db/schema.js';

it('concurrent requests are audited into request_logs', async () => {
  const dbPath = path.join(os.tmpdir(), `deployer-test-${Date.now()}-${process.pid}.db`);
  // ensure minimal schema exists so services (metrics, request-audit) can run
  // create tables using better-sqlite3 raw connection
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = (await import('better-sqlite3')).default;
  const raw = new Database(dbPath);
  raw.exec(`CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER, updated_at INTEGER, api_key_hash TEXT, api_key_prefix TEXT);`);
  raw.exec(`CREATE TABLE IF NOT EXISTS app_metrics (id TEXT PRIMARY KEY, app_id TEXT, timestamp INTEGER, status TEXT, cpu REAL, memory_mb REAL);`);
  raw.exec(`CREATE TABLE IF NOT EXISTS request_logs (id TEXT PRIMARY KEY, method TEXT NOT NULL, path TEXT NOT NULL, headers TEXT NOT NULL, body TEXT, status_code INTEGER, token_info TEXT, created_at INTEGER NOT NULL);`);
  raw.close();

  const db = getDb(dbPath);

  const config = {
    port: 0,
    adminToken: '0123456789abcdef',
    envEncryptionKey: 'a'.repeat(64),
    allowedDeployPaths: '/tmp',
    dbPath,
    corsOrigins: undefined,
    dockerMode: false,
    runtimeMode: 'host',
    imageBuilder: 'docker',
    baseNodeImage: 'node:18-alpine',
    basePythonImage: 'python:3.11-slim',
    imageTagPrefix: 'deployer',
    imageBuildArgs: undefined,
    imageBuildTimeoutSeconds: 300,
    schedulerEnabled: false,
    versionUpstreamUrl: undefined,
    allowSelfShutdown: false,
    allowSelfShutdownDelete: false,
    allowPersistRegistryCredentials: false,
    versionCheckCacheTtlSeconds: 3600,
  };

  const fastify = await createServer(config, db as any);
  await fastify.listen({ port: 0 });
  const address = fastify.server.address();
  // @ts-ignore
  const port = typeof address === 'object' && address ? address.port : 3000;
  const url = `http://127.0.0.1:${port}`;

  const CONC = 20;
  const tasks: Promise<any>[] = [];
  for (let i = 0; i < CONC; i++) {
    tasks.push(fetch(`${url}/health`).then(r => r.text()));
  }
  await Promise.all(tasks);

  // wait for audit hooks to complete (poll up to 2s)
  const deadline = Date.now() + 2000;
  let rows: any[] = [];
  while (Date.now() < deadline) {
    rows = await db.select().from(requestLogs);
    if ((rows.length ?? 0) >= CONC) break;
    await new Promise(r => setTimeout(r, 100));
  }

  await fastify.close();

  expect(rows.length).toBeGreaterThanOrEqual(CONC);
});
