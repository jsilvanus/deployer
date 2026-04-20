import { join } from 'node:path';
import { mkdir, rm, access } from 'node:fs/promises';
import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';
import { AppEnvService } from '../../services/app-env.service.js';

interface PypiInstallSnapshot {
  packageName: string;
  previousVersion: string | null;
}

async function getInstalledVersion(deployPath: string, packageName: string): Promise<string | null> {
  try {
    const pip = join(deployPath, '.venv', 'bin', 'pip');
    const { stdout } = await execa(pip, ['show', packageName]);
    const match = /^Version:\s*(.+)$/m.exec(stdout);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export const pypiInstallPackageStep: DeploymentStep = {
  name: 'pypi-install-package',
  reversible: true,

  async captureSnapshot(ctx): Promise<Record<string, unknown>> {
    const packageName = ctx.app.packageName;
    if (!packageName) return { packageName: '', previousVersion: null };
    const previousVersion = await getInstalledVersion(ctx.app.deployPath, packageName);
    return { packageName, previousVersion } satisfies PypiInstallSnapshot;
  },

  async execute(ctx): Promise<void> {
    const packageName = ctx.app.packageName;
    if (!packageName) throw new Error('packageName is required for pypi app type');

    await mkdir(ctx.app.deployPath, { recursive: true });

    const venvPath = join(ctx.app.deployPath, '.venv');
    try {
      await access(join(venvPath, 'bin', 'pip'));
    } catch {
      ctx.logger.info({ deployPath: ctx.app.deployPath }, 'creating venv');
      await execa('python3', ['-m', 'venv', venvPath]);
    }

    const pip = join(venvPath, 'bin', 'pip');
    const version = ctx.app.packageVersion;
    const packageSpec = version && version !== 'latest' ? `${packageName}==${version}` : packageName;

    const envSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const token    = await envSvc.get(ctx.app.id, '_REGISTRY_TOKEN');
    const username = await envSvc.get(ctx.app.id, '_REGISTRY_USERNAME');
    const registry = ctx.app.registryUrl;

    const extraArgs: string[] = [];
    if (registry) {
      const indexUrl = new URL(registry);
      if (token) {
        indexUrl.username = username ?? '__token__';
        indexUrl.password = token;
      }
      extraArgs.push('--extra-index-url', indexUrl.toString());
    }

    ctx.logger.info({ packageSpec }, 'pip install');
    await execa(pip, ['install', '--upgrade', ...extraArgs, packageSpec]);
  },

  async rollback(ctx, snapshot): Promise<void> {
    const { packageName, previousVersion } = snapshot as unknown as PypiInstallSnapshot;
    if (previousVersion && packageName) {
      const pip = join(ctx.app.deployPath, '.venv', 'bin', 'pip');
      ctx.logger.info({ packageName, previousVersion }, 'pip rollback: reinstalling previous version');
      await execa(pip, ['install', `${packageName}==${previousVersion}`]);
    } else {
      await rm(ctx.app.deployPath, { recursive: true, force: true });
    }
  },
};
