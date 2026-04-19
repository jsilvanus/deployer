import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';
import { AppEnvService } from '../../services/app-env.service.js';

export const imagePullStep: DeploymentStep = {
  name: 'image-pull',
  reversible: false,

  async captureSnapshot(): Promise<Record<string, unknown>> {
    return {};
  },

  async execute(ctx): Promise<void> {
    const packageName = ctx.app.packageName;
    if (!packageName) throw new Error('packageName is required for image app type');
    const tag = ctx.app.packageVersion ?? 'latest';
    const imageRef = `${packageName}:${tag}`;

    const envSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const token    = await envSvc.get(ctx.app.id, '_REGISTRY_TOKEN');
    const username = await envSvc.get(ctx.app.id, '_REGISTRY_USERNAME');
    const registry = ctx.app.registryUrl;

    if (token && registry) {
      ctx.logger.info({ registry }, 'docker login');
      await execa('docker', ['login', registry, '--username', username ?? 'token', '--password-stdin'], {
        input: token,
      });
    }

    ctx.logger.info({ imageRef }, 'docker pull');
    await execa('docker', ['pull', imageRef]);
  },

  async rollback(): Promise<void> {
    // not reversible — docker-compose-up handles container state rollback
  },
};
