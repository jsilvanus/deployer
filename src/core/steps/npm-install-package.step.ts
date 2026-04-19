import { join } from 'node:path';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';

interface NpmInstallSnapshot {
  packageName: string;
  previousVersion: string | null;
}

export const npmInstallPackageStep: DeploymentStep = {
  name: 'npm-install-package',
  reversible: true,

  async captureSnapshot(ctx): Promise<Record<string, unknown>> {
    const packageName = ctx.app.packageName;
    if (!packageName) return { packageName: '', previousVersion: null };
    try {
      const pkgJsonPath = join(ctx.app.deployPath, 'node_modules', packageName, 'package.json');
      const raw = await readFile(pkgJsonPath, 'utf8');
      const pkg = JSON.parse(raw) as { version?: string };
      return { packageName, previousVersion: pkg.version ?? null } satisfies NpmInstallSnapshot;
    } catch {
      return { packageName, previousVersion: null } satisfies NpmInstallSnapshot;
    }
  },

  async execute(ctx): Promise<void> {
    const packageName = ctx.app.packageName;
    if (!packageName) throw new Error('packageName is required for npm app type');

    await mkdir(ctx.app.deployPath, { recursive: true });

    const version = ctx.app.packageVersion ?? 'latest';
    const packageSpec = `${packageName}@${version}`;
    ctx.logger.info({ packageSpec, deployPath: ctx.app.deployPath }, 'npm install package');
    await execa('npm', ['install', '--prefix', ctx.app.deployPath, packageSpec], {
      cwd: ctx.app.deployPath,
    });
  },

  async rollback(ctx, snapshot): Promise<void> {
    const { packageName, previousVersion } = snapshot as NpmInstallSnapshot;
    if (previousVersion && packageName) {
      ctx.logger.info({ packageName, previousVersion }, 'npm rollback: reinstalling previous version');
      await execa('npm', ['install', '--prefix', ctx.app.deployPath, `${packageName}@${previousVersion}`], {
        cwd: ctx.app.deployPath,
      });
    } else {
      await rm(ctx.app.deployPath, { recursive: true, force: true });
    }
  },
};
