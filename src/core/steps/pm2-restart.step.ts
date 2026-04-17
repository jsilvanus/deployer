import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { Pm2Service } from '../../services/pm2.service.js';
import { GitService } from '../../services/git.service.js';
import type { Pm2RestartSnapshotData } from '../../types/snapshot.js';

export const pm2RestartStep: DeploymentStep = {
  name: 'pm2-restart',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const pm2 = new Pm2Service(ctx.logger);
    const git = new GitService(ctx.logger);
    const info = await pm2.status(ctx.app.name);
    const commitHash = await git.getCurrentHash(ctx.app.deployPath);
    const data: Pm2RestartSnapshotData = {
      processName: ctx.app.name,
      statusBefore: info?.status ?? 'unknown',
      commitHashBefore: commitHash,
      repoPath: ctx.app.deployPath,
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const pm2 = new Pm2Service(ctx.logger);
    await pm2.restart(ctx.app.name);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as Pm2RestartSnapshotData;
    const git = new GitService(ctx.logger);
    const pm2 = new Pm2Service(ctx.logger);
    await git.resetHard(data.repoPath, data.commitHashBefore);
    await pm2.restart(data.processName);
  },
};
