import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { Pm2Service } from '../../services/pm2.service.js';
import type { Pm2StartSnapshotData } from '../../types/snapshot.js';

async function detectNodeScript(appPath: string): Promise<string> {
  try {
    const raw = await readFile(join(appPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { main?: string };
    if (pkg.main) return pkg.main;
  } catch { /* ignore */ }
  return 'index.js';
}

async function detectPythonScript(appPath: string): Promise<string> {
  for (const candidate of ['main.py', 'app.py', 'run.py', 'manage.py', 'wsgi.py']) {
    try {
      await access(join(appPath, candidate));
      return candidate;
    } catch { /* not found */ }
  }
  return 'app.py';
}

async function detectPythonInterpreter(appPath: string): Promise<string> {
  for (const venv of ['.venv/bin/python', 'venv/bin/python']) {
    try {
      await access(join(appPath, venv));
      return venv;
    } catch { /* not found */ }
  }
  return 'python3';
}

export const pm2StartStep: DeploymentStep = {
  name: 'pm2-start',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const data: Pm2StartSnapshotData = { processName: ctx.app.name };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const pm2 = new Pm2Service(ctx.logger);
    const isPython = ctx.app.type === 'python';
    const isNpm    = ctx.app.type === 'npm';

    let script: string;
    if (isNpm) {
      const packageName = ctx.app.packageName;
      if (!packageName) throw new Error('packageName is required for npm app type');
      const installedPkgJson = join(ctx.app.deployPath, 'node_modules', packageName, 'package.json');
      const raw = await readFile(installedPkgJson, 'utf8');
      const pkg = JSON.parse(raw) as { main?: string };
      script = join('node_modules', packageName, pkg.main ?? 'index.js');
    } else if (isPython) {
      script = await detectPythonScript(ctx.app.deployPath);
    } else {
      script = await detectNodeScript(ctx.app.deployPath);
    }

    const interpreter = isPython
      ? await detectPythonInterpreter(ctx.app.deployPath)
      : undefined;

    await pm2.start({
      name:        ctx.app.name,
      script,
      cwd:         ctx.app.deployPath,
      envFile:     join(ctx.app.deployPath, '.env'),
      ...(interpreter !== undefined && { interpreter }),
    });
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as Pm2StartSnapshotData;
    await new Pm2Service(ctx.logger).delete(data.processName);
  },
};
