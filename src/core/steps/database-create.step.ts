import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext, App } from '../../types/index.js';
import { DatabaseService, type PgConnection } from '../../services/database.service.js';
import { AppEnvService } from '../../services/app-env.service.js';
import type { DatabaseCreateSnapshotData } from '../../types/snapshot.js';

async function pgConnectionFor(app: App, envSvc: AppEnvService): Promise<PgConnection> {
  return {
    host:     app.pgHost     ?? 'localhost',
    port:     app.pgPort     ?? 5432,
    user:     app.pgAdminUser ?? 'postgres',
    password: (await envSvc.get(app.id, '_PG_ADMIN_PASSWORD')) ?? '',
  };
}

export const databaseCreateStep: DeploymentStep = {
  name: 'database-create',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    if (!ctx.app.dbEnabled || ctx.app.dbType === 'sqlite') {
      const data: DatabaseCreateSnapshotData = { dbName: '', dbUser: '', created: false };
      return data as unknown as Record<string, unknown>;
    }

    const appEnvSvcSnap = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const dbSvc = new DatabaseService(ctx.logger, await pgConnectionFor(ctx.app, appEnvSvcSnap));
    const dbName = ctx.app.dbName ?? ctx.app.name;
    const existed = await dbSvc.databaseExists(dbName);
    const data: DatabaseCreateSnapshotData = {
      dbName,
      dbUser: dbName,
      created: !existed,
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    if (!ctx.app.dbEnabled) return;
    if (ctx.app.dbType === 'sqlite') {
      ctx.logger.info('sqlite database; skipping server-side provisioning');
      return;
    }

    const appEnvSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const dbSvc = new DatabaseService(ctx.logger, await pgConnectionFor(ctx.app, appEnvSvc));
    const dbName = ctx.app.dbName ?? ctx.app.name;

    if (await dbSvc.databaseExists(dbName)) {
      ctx.logger.info({ dbName }, 'database already exists; skipping creation');
      return;
    }

    // Resolution order: stored per-app var → request option → env var → db name (insecure fallback)
    const password =
      (await appEnvSvc.get(ctx.app.id, 'DB_PASSWORD')) ??
      (ctx.options?.['dbPassword'] as string | undefined) ??
      process.env['DB_PASSWORD'] ??
      dbName;

    await dbSvc.createDatabase(dbName);
    await dbSvc.createUser(dbName, password);
    await dbSvc.grantAll(dbName, dbName);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as DatabaseCreateSnapshotData;
    if (!data.created) return;

    if (!ctx.options?.['allowDbDrop']) {
      ctx.logger.warn(
        { dbName: data.dbName },
        'Database rollback skipped: pass allowDbDrop=true to enable destructive DB rollback',
      );
      return;
    }

    const appEnvSvcRollback = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const dbSvc = new DatabaseService(ctx.logger, await pgConnectionFor(ctx.app, appEnvSvcRollback));
    await dbSvc.dropDatabase(data.dbName);
    await dbSvc.dropUser(data.dbUser);
  },
};
