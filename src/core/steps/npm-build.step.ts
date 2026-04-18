import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';

export const npmBuildStep: DeploymentStep = {
  name: 'npm-build',
  reversible: false,

  async captureSnapshot(): Promise<Record<string, unknown>> {
    return {};
  },

  async execute(ctx): Promise<void> {
    ctx.logger.info({ cwd: ctx.app.deployPath }, 'npm install');
    await execa('npm', ['install', '--production=false'], { cwd: ctx.app.deployPath });

    const raw = await readFile(join(ctx.app.deployPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.['build']) {
      ctx.logger.info({ cwd: ctx.app.deployPath }, 'npm run build');
      await execa('npm', ['run', 'build'], { cwd: ctx.app.deployPath });
    }
  },

  async rollback(): Promise<void> {
    // not reversible — previous dist/ is already overwritten by git pull
  },
};
