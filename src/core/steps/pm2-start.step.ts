import { join } from 'node:path';
import { readFile, access, writeFile } from 'node:fs/promises';
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
    const appType = ctx.app.type;

    let script: string;
    let interpreter: string | undefined;

    if (appType === 'npm') {
      const packageName = ctx.app.packageName;
      if (!packageName) throw new Error('packageName is required for npm app type');
      const installedPkgJson = join(ctx.app.deployPath, 'node_modules', packageName, 'package.json');
      const raw = await readFile(installedPkgJson, 'utf8');
      const pkg = JSON.parse(raw) as { main?: string };
      script = join('node_modules', packageName, pkg.main ?? 'index.js');
    } else if (appType === 'pypi') {
      const packageName = ctx.app.packageName;
      if (!packageName) throw new Error('packageName is required for pypi app type');
      // Try console script with name variants (exact, hyphen↔underscore)
      let consoleScript: string | null = null;
      for (const name of [packageName, packageName.replace(/_/g, '-'), packageName.replace(/-/g, '_')]) {
        try {
          await access(join(ctx.app.deployPath, '.venv', 'bin', name));
          consoleScript = join('.venv', 'bin', name);
          break;
        } catch { /* try next */ }
      }
      if (consoleScript) {
        // pip console scripts have the correct shebang; no separate interpreter needed
        script = consoleScript;
      } else {
        // Fallback: python -m <package> via a generated wrapper
        await writeFile(
          join(ctx.app.deployPath, '_start.py'),
          `import runpy\nrunpy.run_module(${JSON.stringify(packageName)}, run_name='__main__', alter_sys=True)\n`,
        );
        script = '_start.py';
        interpreter = join('.venv', 'bin', 'python');
      }
    } else if (appType === 'python') {
      script = await detectPythonScript(ctx.app.deployPath);
      interpreter = await detectPythonInterpreter(ctx.app.deployPath);
    } else {
      script = await detectNodeScript(ctx.app.deployPath);
    }

    await pm2.start({
      name:    ctx.app.name,
      script,
      cwd:     ctx.app.deployPath,
      envFile: join(ctx.app.deployPath, '.env'),
      ...(interpreter !== undefined && { interpreter }),
    });
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as Pm2StartSnapshotData;
    await new Pm2Service(ctx.logger).delete(data.processName);
  },
};
