import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { EnvService } from '../../services/env.service.js';
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
    const envFilePath = join(ctx.app.deployPath, '.env');
    const envVars = ctx.options?.['envVars'] as Record<string, string> | undefined;

    if (!envVars || Object.keys(envVars).length === 0) return;

    const existing = (await envSvc.exists(envFilePath))
      ? await envSvc.read(envFilePath)
      : '';

    const merged = envSvc.mergeVars(existing, envVars);
    await envSvc.write(envFilePath, merged);
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
