import { resolve } from 'node:path';
import { execa } from 'execa';
import type { FastifyInstance } from 'fastify';
import { SETUP_LIMIT } from '../plugins/rate-limit.plugin.js';
import { AppService } from '../../services/app.service.js';
import { DeploymentService } from '../../services/deployment.service.js';
import { DeploymentOrchestrator } from '../../core/orchestrator.js';
import { TraefikService } from '../../services/traefik.service.js';
import { DockerService } from '../../services/docker.service.js';
import { NginxService } from '../../services/nginx.service.js';
import { deployComposePlan } from '../../core/plans/deploy-compose.plan.js';
import { updateComposePlan } from '../../core/plans/update-compose.plan.js';
import { updateDeployerPlan } from '../../core/plans/update-deployer.plan.js';
import { updateNpmPlan } from '../../core/plans/update-npm.plan.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import type { LastModifiedCache } from '../../cache/last-modified.cache.js';

const TRAEFIK_NAME = 'traefik';
const DEFAULT_PORT = 8080;

export async function setupRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config; cache: LastModifiedCache }) {
  const appSvc = new AppService(opts.db, opts.config.envEncryptionKey, opts.cache);
  const deploymentSvc = new DeploymentService(opts.db, opts.cache);
  const orchestrator = new DeploymentOrchestrator(
    deploymentSvc,
    fastify.log,
    opts.config,
    opts.db,
  );

  fastify.post('/setup/traefik', {
    config: { rateLimit: SETUP_LIMIT },
    schema: {
      body: {
        type: 'object',
        properties: {
          mode:       { type: 'string', enum: ['auto', 'standalone', 'behind-nginx'] },
          acmeEmail:  { type: 'string' },
          port:       { type: 'integer', minimum: 1024, maximum: 65535 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });

    const body = (request.body ?? {}) as {
      mode?: 'auto' | 'standalone' | 'behind-nginx';
      acmeEmail?: string;
      port?: number;
    };

    const docker = new DockerService(fastify.log);
    await docker.networkCreate('deployer-internal');

    const traefikSvc = new TraefikService();
    const requestedMode = body.mode ?? 'auto';
    const mode = requestedMode === 'auto' ? await traefikSvc.detectMode() : requestedMode;
    const port = body.port ?? DEFAULT_PORT;

    const composeContent = traefikSvc.generateCompose(mode, {
      ...(body.acmeEmail !== undefined && { acmeEmail: body.acmeEmail }),
      port,
    });

    const deployPath = resolve(
      opts.config.allowedDeployPaths.split(',')[0]?.trim() ?? '/srv/apps',
      TRAEFIK_NAME,
    );

    // Create or update the traefik app
    const existing = await appSvc.findByName(TRAEFIK_NAME);
    let app;
    let isNew: boolean;

    if (!existing) {
      const result = await appSvc.create({
        name: TRAEFIK_NAME,
        type: 'compose',
        deployPath,
        composeContent,
      });
      app = result.app;
      isNew = true;
    } else {
      const updated = await appSvc.update(existing.id, { composeContent });
      app = updated ?? existing;
      isNew = false;
    }

    if (await deploymentSvc.hasRunningDeployment(app.id)) {
      return reply.code(409).send({ error: 'A Traefik deployment is already running' });
    }

    // Persist mode so docker-compose-up step can read it when building app overrides
    const { AppEnvService } = await import('../../services/app-env.service.js');
    const envSvc = new AppEnvService(opts.db, opts.config.envEncryptionKey);
    await envSvc.set(app.id, '_TRAEFIK_MODE', mode);

    const plan = isNew ? deployComposePlan : updateComposePlan;
    const deployment = await deploymentSvc.create(app.id, isNew ? 'deploy' : 'update', 'api');

    setImmediate(() => {
      orchestrator.run(app, deployment.id, plan, {}).catch((err: unknown) => {
        fastify.log.error({ err, deploymentId: deployment.id }, 'Traefik setup failed');
      });
    });

    // For behind-nginx mode: try to write nginx config automatically (bare metal).
    // If that fails (Docker or nginx unavailable), return the config for manual installation.
    let nginxConfig: string | undefined;
    let nginxWritten = false;
    if (mode === 'behind-nginx') {
      nginxConfig = traefikSvc.generateNginxConfig(port);
      try {
        const nginx = new NginxService(fastify.log);
        await nginx.write(TRAEFIK_NAME, nginxConfig);
        nginxWritten = true;
        fastify.log.info('nginx proxy config for Traefik written and enabled');
      } catch {
        fastify.log.warn(
          'Could not write nginx config automatically — returning it for manual installation',
        );
      }
    }

    return reply.code(202).send({
      deploymentId: deployment.id,
      mode,
      ...(nginxConfig !== undefined && !nginxWritten ? { nginxConfig } : {}),
      message: `Traefik ${isNew ? 'deployment' : 'update'} started (${mode})`,
    });
  });

  // ── Self-registration ──────────────────────────────────────────────────────

  fastify.post('/setup/self-register', {
    config: { rateLimit: SETUP_LIMIT },
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string' },
          repoUrl:     { type: 'string' },
          branch:      { type: 'string' },
          deployPath:  { type: 'string' },
          packageName: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });

    const body = (request.body ?? {}) as {
      name?: string;
      repoUrl?: string;
      branch?: string;
      deployPath?: string;
      packageName?: string;
    };

    const name       = body.name       ?? 'deployer';
    const deployPath = resolve(body.deployPath ?? process.cwd());
    const branch     = body.branch     ?? 'main';

    const existing = await appSvc.findByName(name);
    if (existing) {
      return { app: existing, message: 'Already registered' };
    }

    // Auto-detect repoUrl from git remote if not provided
    let repoUrl = body.repoUrl;
    if (!repoUrl) {
      try {
        const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: deployPath });
        repoUrl = stdout.trim();
      } catch { /* no git remote — register as npm type below */ }
    }

    let result;
    if (repoUrl) {
      result = await appSvc.create({ name, type: 'node', repoUrl, branch, deployPath });
    } else {
      const packageName = body.packageName ?? '@jsilvanus/deployer';
      result = await appSvc.create({ name, type: 'npm', deployPath, packageName, packageVersion: 'latest' });
    }

    return reply.code(201).send({
      app:     result.app,
      apiKey:  result.apiKey,
      message: 'Deployer self-registered successfully',
    });
  });

  // ── Self-update ────────────────────────────────────────────────────────────

  fastify.post('/setup/self-update', {
    config: { rateLimit: SETUP_LIMIT },
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });

    const body = (request.body ?? {}) as { name?: string };
    const name = body.name ?? 'deployer';

    const app = await appSvc.findByName(name);
    if (!app) {
      return reply.code(404).send({
        error: `App "${name}" not found — call POST /setup/self-register first`,
      });
    }

    if (await deploymentSvc.hasRunningDeployment(app.id)) {
      return reply.code(409).send({ error: 'A deployment is already running for this app' });
    }

    const deployment = await deploymentSvc.create(app.id, 'update', 'api');
    const selfUpdatePlan = app.type === 'npm' ? updateNpmPlan : updateDeployerPlan;

    setImmediate(() => {
      orchestrator.run(app, deployment.id, selfUpdatePlan, {}).catch((err: unknown) => {
        fastify.log.error({ err, deploymentId: deployment.id }, 'Self-update failed');
      });
    });

    return reply.code(202).send({
      deploymentId: deployment.id,
      status:       deployment.status,
      message:      'Self-update started — deployer will restart after build completes',
    });
  });
}
