import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { Pm2Service } from '../../services/pm2.service.js';
import type { Pm2StartSnapshotData } from '../../types/snapshot.js';

async function detectScript(appPath: string): Promise<string> {
  try {
    const raw = await readFile(join(appPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { main?: string; scripts?: { start?: string } };
    if (pkg.main) return pkg.main;
  } catch {
    // ignore
  }
  return 'index.js';
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
    const script = await detectScript(ctx.app.deployPath);
    const envFilePath = join(ctx.app.deployPath, '.env');
    await pm2.start({
      name: ctx.app.name,
      script,
      cwd: ctx.app.deployPath,
      envFile: envFilePath,
    });
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as Pm2StartSnapshotData;
    const pm2 = new Pm2Service(ctx.logger);
    await pm2.delete(data.processName);
  },
};
