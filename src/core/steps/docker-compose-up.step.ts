import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { DockerService } from '../../services/docker.service.js';
import { AppService } from '../../services/app.service.js';
import { AppEnvService } from '../../services/app-env.service.js';
import { TraefikService, type TraefikMode } from '../../services/traefik.service.js';
import type { DockerComposeUpSnapshotData } from '../../types/snapshot.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TRAEFIK_OVERRIDE  = 'docker-compose.traefik.yml';
const INTERNAL_OVERRIDE = 'docker-compose.internal.yml';

async function buildTraefikOverride(ctx: StepContext): Promise<string | null> {
  if (!ctx.app.domain || !ctx.app.primaryService) return null;
  const traefik = await new AppService(ctx.db, ctx.config.envEncryptionKey).findByName('traefik');
  if (!traefik) return null;

  const mode = ((await new AppEnvService(ctx.db, ctx.config.envEncryptionKey)
    .get(traefik.id, '_TRAEFIK_MODE')) ?? 'standalone') as TraefikMode;

  const content = new TraefikService().generateAppOverride({
    appName:        ctx.app.name,
    primaryService: ctx.app.primaryService,
    domain:         ctx.app.domain,
    port:           ctx.app.port ?? 3000,
    mode,
  });
  const path = join(ctx.app.deployPath, TRAEFIK_OVERRIDE);
  await writeFile(path, content, 'utf8');
  ctx.logger.info({ domain: ctx.app.domain, mode }, 'traefik override written');
  return path;
}

async function buildInternalOverride(
  ctx: StepContext,
  docker: DockerService,
): Promise<string | null> {
  await docker.networkCreate('deployer-internal');

  let serviceNames: string[];
  try {
    serviceNames = await docker.composeServiceNames(ctx.app.deployPath);
  } catch {
    ctx.logger.warn('could not detect service names; skipping internal network override');
    return null;
  }
  if (serviceNames.length === 0) return null;

  const content = new TraefikService().generateInternalOverride(serviceNames);
  const path = join(ctx.app.deployPath, INTERNAL_OVERRIDE);
  await writeFile(path, content, 'utf8');
  ctx.logger.info({ services: serviceNames }, 'internal network override written');
  return path;
}

export const dockerComposeUpStep: DeploymentStep = {
  name: 'docker-compose-up',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const docker = new DockerService(ctx.logger);
    let serviceNames: string[] = [];
    try {
      serviceNames = await docker.composeServiceNames(ctx.app.deployPath);
    } catch {
      // compose file may not exist yet on fresh deploy
    }
    const data: DockerComposeUpSnapshotData = {
      composePath: ctx.app.deployPath,
      serviceNames,
    };
    return data as unknown as Record<string, unknown>;
  },

  async execute(ctx: StepContext): Promise<void> {
    const docker = new DockerService(ctx.logger);
    const envFile = join(ctx.app.deployPath, '.env');
    const overrideFiles: string[] = [];

    if (ctx.app.type === 'docker' || ctx.app.type === 'compose') {
      const traefik = await buildTraefikOverride(ctx);
      if (traefik) overrideFiles.push(traefik);
    }

    if (ctx.app.internalNetwork) {
      const internal = await buildInternalOverride(ctx, docker);
      if (internal) overrideFiles.push(internal);
    }

    await docker.composeUp(ctx.app.deployPath, envFile, overrideFiles);
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const data = snapshot as unknown as DockerComposeUpSnapshotData;
    await new DockerService(ctx.logger).composeDown(data.composePath);
  },
};
