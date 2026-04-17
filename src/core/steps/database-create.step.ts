import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { DatabaseService } from '../../services/database.service.js';
import type { DatabaseCreateSnapshotData } from '../../types/snapshot.js';

export const databaseCreateStep: DeploymentStep = {
  name: 'database-create',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const dbSvc = new DatabaseService(ctx.logger);
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
    const dbSvc = new DatabaseService(ctx.logger);
    const dbName = ctx.app.dbName ?? ctx.app.name;

    if (await dbSvc.databaseExists(dbName)) {
      ctx.logger.info({ dbName }, 'database already exists; skipping creation');
      return;
    }

    const dbPassword = (ctx.options?.['dbPassword'] as string | undefined)
      ?? process.env['DB_PASSWORD']
      ?? dbName;

    await dbSvc.createDatabase(dbName);
    await dbSvc.createUser(dbName, dbPassword);
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

    const dbSvc = new DatabaseService(ctx.logger);
    await dbSvc.dropDatabase(data.dbName);
    await dbSvc.dropUser(data.dbUser);
  },
};
