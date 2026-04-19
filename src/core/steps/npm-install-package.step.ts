import { join } from 'node:path';
import { mkdir, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';
import { AppEnvService } from '../../services/app-env.service.js';

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

    const envSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const token    = await envSvc.get(ctx.app.id, '_REGISTRY_TOKEN');
    const registry = ctx.app.registryUrl;

    let npmrcPath: string | null = null;
    if (token || registry) {
      const reg = registry ?? 'https://registry.npmjs.org/';
      const regHost = new URL(reg).host;
      const lines = [`registry=${reg}`];
      if (token) lines.push(`//${regHost}/:_authToken=${token}`);
      npmrcPath = join(ctx.app.deployPath, '.npmrc');
      await writeFile(npmrcPath, lines.join('\n') + '\n');
    }

    const version = ctx.app.packageVersion ?? 'latest';
    const packageSpec = `${packageName}@${version}`;
    ctx.logger.info({ packageSpec, deployPath: ctx.app.deployPath }, 'npm install package');
    try {
      await execa('npm', ['install', '--prefix', ctx.app.deployPath, packageSpec], {
        cwd: ctx.app.deployPath,
      });
    } finally {
      if (npmrcPath) await unlink(npmrcPath).catch(() => undefined);
    }
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
