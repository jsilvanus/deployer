import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { DockerService } from '../../services/docker.service.js';
import type { DockerBuildSnapshotData } from '../../types/snapshot.js';

export const dockerBuildStep: DeploymentStep = {
  name: 'docker-build',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const docker = new DockerService(ctx.logger);
    const imageName = ctx.app.name;
    const previousId = await docker.getImageId(imageName, 'latest');
    const newTag = `deploy-${Date.now()}`;
    const data: DockerBuildSnapshotData = {
      imageName,
      newImageTag: newTag,
      ...(previousId != null ? { previousImageTag: 'latest' } : {}),
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const docker = new DockerService(ctx.logger);
    const imageName = ctx.app.name;
    const tag = `deploy-${Date.now()}`;

    await docker.build({
      contextPath: ctx.app.deployPath,
      imageName,
      imageTag: tag,
    });
    // Also tag as latest
    await docker.tag(imageName, tag, 'latest');
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as DockerBuildSnapshotData;
    const docker = new DockerService(ctx.logger);
    await docker.removeImage(data.imageName, data.newImageTag);
  },
};
