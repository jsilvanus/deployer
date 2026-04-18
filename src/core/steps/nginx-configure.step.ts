import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { NginxService } from '../../services/nginx.service.js';
import type { NginxConfigureSnapshotData } from '../../types/snapshot.js';

export const nginxConfigureStep: DeploymentStep = {
  name: 'nginx-configure',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const nginx = new NginxService(ctx.logger);
    const existed = await nginx.exists(ctx.app.name);
    const configPath = nginx.configPath(ctx.app.name);
    const symlinkPath = nginx.symlinkPath(ctx.app.name);
    const existingContent = existed ? await nginx.read(ctx.app.name) : null;
    const data: NginxConfigureSnapshotData = {
      configPath,
      symlinkPath,
      configExistedBefore: existed,
      ...(existingContent != null ? { configContentBefore: existingContent } : {}),
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    if (!ctx.app.nginxEnabled || !ctx.app.domain) return;
    const nginx = new NginxService(ctx.logger);
    const port = ctx.app.port ?? 3000;
    const config = nginx.generateBlock({
      appName: ctx.app.name,
      domain: ctx.app.domain,
      upstreamPort: port,
    });
    await nginx.write(ctx.app.name, config);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as NginxConfigureSnapshotData;
    const nginx = new NginxService(ctx.logger);
    await nginx.restore(ctx.app.name, data.configContentBefore ?? null);
  },
};
