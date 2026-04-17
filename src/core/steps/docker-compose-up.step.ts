import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { DockerService } from '../../services/docker.service.js';
import type { DockerComposeUpSnapshotData } from '../../types/snapshot.js';
import { join } from 'node:path';

export const dockerComposeUpStep: DeploymentStep = {
  name: 'docker-compose-up',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const docker = new DockerService(ctx.logger);
    const composePath = ctx.app.deployPath;
    let serviceNames: string[] = [];
    try {
      serviceNames = await docker.composeServiceNames(composePath);
    } catch {
      // compose file may not exist yet for fresh deploy
    }
    const data: DockerComposeUpSnapshotData = { composePath, serviceNames };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const docker = new DockerService(ctx.logger);
    const envFile = join(ctx.app.deployPath, '.env');
    await docker.composeUp(ctx.app.deployPath, envFile);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as DockerComposeUpSnapshotData;
    const docker = new DockerService(ctx.logger);
    await docker.composeDown(data.composePath);
  },
};
