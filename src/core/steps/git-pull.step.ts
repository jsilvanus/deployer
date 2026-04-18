import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { GitService } from '../../services/git.service.js';
import type { GitPullSnapshotData } from '../../types/snapshot.js';

export const gitPullStep: DeploymentStep = {
  name: 'git-pull',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const git = new GitService(ctx.logger);
    const commitHashBefore = await git.getCurrentHash(ctx.app.deployPath);
    const data: GitPullSnapshotData = {
      repoPath: ctx.app.deployPath,
      commitHashBefore,
      branch: ctx.app.branch,
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const git = new GitService(ctx.logger);
    await git.pull(ctx.app.deployPath);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as GitPullSnapshotData;
    const git = new GitService(ctx.logger);
    await git.resetHard(data.repoPath, data.commitHashBefore);
  },
};
