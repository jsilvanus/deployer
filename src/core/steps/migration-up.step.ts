import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { MigrationService } from '../../services/migration.service.js';
import type { MigrationUpSnapshotData } from '../../types/snapshot.js';

export const migrationUpStep: DeploymentStep = {
  name: 'migration-up',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const migSvc = new MigrationService(ctx.logger);
    const runner = await migSvc.detectRunner(ctx.app.deployPath);
    const data: MigrationUpSnapshotData = {
      runner: runner ?? 'sql',
      appliedMigrations: [],
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const migSvc = new MigrationService(ctx.logger);
    const runner = await migSvc.detectRunner(ctx.app.deployPath);
    if (!runner) {
      ctx.logger.info({ appPath: ctx.app.deployPath }, 'no migration runner detected; skipping migrations');
      return;
    }
    await migSvc.runUp(ctx.app.deployPath, runner);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as MigrationUpSnapshotData;
    if (data.appliedMigrations.length === 0) return;

    const migSvc = new MigrationService(ctx.logger);
    await migSvc.runDown(ctx.app.deployPath, data.runner, data.appliedMigrations);
  },
};
