import { rm } from 'node:fs/promises';
import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { GitService } from '../../services/git.service.js';
import { AppEnvService } from '../../services/app-env.service.js';
import type { GitCloneSnapshotData } from '../../types/snapshot.js';

export const gitCloneStep: DeploymentStep = {
  name: 'git-clone',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const data: GitCloneSnapshotData = { repoPath: ctx.app.deployPath };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const git = new GitService(ctx.logger);
    const envSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const token    = await envSvc.get(ctx.app.id, '_REGISTRY_TOKEN') ?? undefined;
    const username = await envSvc.get(ctx.app.id, '_REGISTRY_USERNAME') ?? undefined;
    await git.clone(ctx.app.repoUrl, ctx.app.deployPath, ctx.app.branch, token ? { token, username } : undefined);
  },

  async rollback(_ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as GitCloneSnapshotData;
    await rm(data.repoPath, { recursive: true, force: true });
  },
};
