import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { DockerService } from '../../services/docker.service.js';
import { AppService } from '../../services/app.service.js';
import { AppEnvService } from '../../services/app-env.service.js';
import { TraefikService, type TraefikMode } from '../../services/traefik.service.js';
import type { DockerComposeUpSnapshotData } from '../../types/snapshot.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TRAEFIK_OVERRIDE = 'docker-compose.traefik.yml';

async function buildTraefikOverride(ctx: StepContext): Promise<string | null> {
  const { app, db, config } = ctx;
  if (!app.domain || !app.primaryService) return null;

  const appSvc = new AppService(db, config.envEncryptionKey);
  const traefik = await appSvc.findByName('traefik');
  if (!traefik) return null;

  const envSvc = new AppEnvService(db, config.envEncryptionKey);
  const mode = ((await envSvc.get(traefik.id, '_TRAEFIK_MODE')) ?? 'standalone') as TraefikMode;

  const content = new TraefikService().generateAppOverride({
    appName:        app.name,
    primaryService: app.primaryService,
    domain:         app.domain,
    port:           app.port ?? 3000,
    mode,
  });

  const overridePath = join(app.deployPath, TRAEFIK_OVERRIDE);
  await writeFile(overridePath, content, 'utf8');
  ctx.logger.info({ domain: app.domain, mode }, 'traefik override written');
  return overridePath;
}

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

    const overrideFiles: string[] = [];
    if (ctx.app.type === 'docker') {
      const overridePath = await buildTraefikOverride(ctx);
      if (overridePath) overrideFiles.push(overridePath);
    }

    await docker.composeUp(ctx.app.deployPath, envFile, overrideFiles);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as DockerComposeUpSnapshotData;
    const docker = new DockerService(ctx.logger);
    await docker.composeDown(data.composePath);
  },
};
