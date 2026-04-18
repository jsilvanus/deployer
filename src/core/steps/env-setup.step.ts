import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { EnvService } from '../../services/env.service.js';
import { AppEnvService } from '../../services/app-env.service.js';
import type { EnvSetupSnapshotData } from '../../types/snapshot.js';

export const envSetupStep: DeploymentStep = {
  name: 'env-setup',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const envSvc = new EnvService(ctx.db, ctx.logger, ctx.config.envEncryptionKey);
    const envFilePath = join(ctx.app.deployPath, '.env');
    const existed = await envSvc.exists(envFilePath);

    const data: EnvSetupSnapshotData = {
      envFilePath,
      envFileExistedBefore: existed,
    };

    if (existed) {
      const content = await envSvc.read(envFilePath);
      data.envFileChecksumBefore = envSvc.checksum(content);
      const backupId = await envSvc.snapshot(ctx.app.id, ctx.deployment.id, envFilePath);
      if (backupId) data.encryptedBackupId = backupId;
    }

    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const envSvc = new EnvService(ctx.db, ctx.logger, ctx.config.envEncryptionKey);
    const appEnvSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const envFilePath = join(ctx.app.deployPath, '.env');

    // Stored vars are the baseline (lowest priority)
    const storedVars = await appEnvSvc.getAll(ctx.app.id);
    // Request-time vars override stored vars
    const requestVars = (ctx.options?.['envVars'] as Record<string, string> | undefined) ?? {};
    const merged = { ...storedVars, ...requestVars };

    if (Object.keys(merged).length === 0) return;

    const existing = (await envSvc.exists(envFilePath))
      ? await envSvc.read(envFilePath)
      : '';

    await envSvc.write(envFilePath, envSvc.mergeVars(existing, merged));
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as EnvSetupSnapshotData;
    const envSvc = new EnvService(ctx.db, ctx.logger, ctx.config.envEncryptionKey);

    if (data.encryptedBackupId) {
      await envSvc.restore(data.encryptedBackupId, data.envFilePath);
    } else if (!data.envFileExistedBefore) {
      await rm(data.envFilePath, { force: true });
    }
  },
};
