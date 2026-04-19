import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';

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
    ctx.logger.info({ imageRef }, 'docker pull');
    await execa('docker', ['pull', imageRef]);
  },

  async rollback(): Promise<void> {
    // not reversible — docker-compose-up handles container state rollback
  },
};
