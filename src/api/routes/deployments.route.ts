import type { FastifyInstance } from 'fastify';
import { DeploymentService } from '../../services/deployment.service.js';
import { AppService } from '../../services/app.service.js';
import { MigrationService } from '../../services/migration.service.js';
import { DeploymentOrchestrator } from '../../core/orchestrator.js';
import { deploymentIdParam, deployBody, migrateBody } from '../schemas/deployment.schema.js';
import { appIdParam } from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import type { LastModifiedCache } from '../../cache/last-modified.cache.js';
import { DEPLOY_LIMIT } from '../plugins/rate-limit.plugin.js';
import { deployNodePlan } from '../../core/plans/deploy-node.plan.js';
import { updateNodePlan } from '../../core/plans/update-node.plan.js';
import { deployDockerPlan } from '../../core/plans/deploy-docker.plan.js';
import { updateDockerPlan } from '../../core/plans/update-docker.plan.js';
import { deployComposePlan } from '../../core/plans/deploy-compose.plan.js';
import { updateComposePlan } from '../../core/plans/update-compose.plan.js';
import { deployPythonPlan } from '../../core/plans/deploy-python.plan.js';
import { updatePythonPlan } from '../../core/plans/update-python.plan.js';
import { deployNpmPlan } from '../../core/plans/deploy-npm.plan.js';
import { updateNpmPlan } from '../../core/plans/update-npm.plan.js';
import { deployPypiPlan } from '../../core/plans/deploy-pypi.plan.js';
import { updatePypiPlan } from '../../core/plans/update-pypi.plan.js';
import { deployImagePlan } from '../../core/plans/deploy-image.plan.js';
import { updateImagePlan } from '../../core/plans/update-image.plan.js';

const truncSec = (d: Date) => Math.floor(d.getTime() / 1000);

export async function deploymentsRoutes(
  fastify: FastifyInstance,
  opts: { db: Db; config: Config; cache: LastModifiedCache },
) {
  const deploymentSvc = new DeploymentService(opts.db, opts.cache);
  const appSvc = new AppService(opts.db, opts.config.envEncryptionKey, opts.cache);
  const orchestrator = new DeploymentOrchestrator(
    deploymentSvc,
    fastify.log,
    opts.config,
    opts.db,
  );

  fastify.get('/deployments/:deploymentId', {
    schema: { params: deploymentIdParam },
  }, async (request, reply) => {
    const { deploymentId } = request.params as { deploymentId: string };
    // Preflight: if cache is warm and client is up-to-date, skip DB entirely.
    // A valid If-Modified-Since implies the client received a prior 200 (and was authorized).
    const cached = opts.cache.get(`deployment:${deploymentId}`);
    const ims = request.headers['if-modified-since'];
    if (cached && ims && truncSec(new Date(ims)) >= truncSec(cached)) {
      return reply.code(304).send();
    }
    const deployment = await deploymentSvc.findById(deploymentId);
    if (!deployment) return reply.code(404).send({ error: 'Deployment not found' });
    if (!request.isAdmin && request.scopedAppId !== deployment.appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    // Populate cache on cold start; use finishedAt for terminal deployments
    if (!cached) opts.cache.touch(`deployment:${deploymentId}`, deployment.finishedAt ?? deployment.createdAt);
    reply.header('Last-Modified', (opts.cache.get(`deployment:${deploymentId}`) ?? deployment.createdAt).toUTCString());
    return deployment;
  });

  fastify.get('/deployments/:deploymentId/snapshots', {
    schema: { params: deploymentIdParam },
  }, async (request, reply) => {
    const { deploymentId } = request.params as { deploymentId: string };
    // Snapshots are frozen once the deployment finishes — reuse the deployment cache key
    const cached = opts.cache.get(`deployment:${deploymentId}`);
    const ims = request.headers['if-modified-since'];
    if (cached && ims && truncSec(new Date(ims)) >= truncSec(cached)) {
      return reply.code(304).send();
    }
    const deployment = await deploymentSvc.findById(deploymentId);
    if (!deployment) return reply.code(404).send({ error: 'Deployment not found' });
    if (!request.isAdmin && request.scopedAppId !== deployment.appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!cached) opts.cache.touch(`deployment:${deploymentId}`, deployment.finishedAt ?? deployment.createdAt);
    reply.header('Last-Modified', (opts.cache.get(`deployment:${deploymentId}`) ?? deployment.createdAt).toUTCString());
    return deploymentSvc.getSnapshots(deploymentId);
  });

  fastify.post('/apps/:appId/deploy', {
    schema: { params: appIdParam, body: deployBody },
    config: { rateLimit: DEPLOY_LIMIT },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    if (await deploymentSvc.hasRunningDeployment(appId)) {
      return reply.code(409).send({ error: 'A deployment is already running for this app' });
    }

    const body = (request.body ?? {}) as {
      triggeredBy?: 'api' | 'mcp';
      allowDbDrop?: boolean;
      envVars?: Record<string, string>;
    };
    const deployment = await deploymentSvc.create(appId, 'deploy', body.triggeredBy ?? 'api');
    const plan = app.type === 'compose' ? deployComposePlan
               : app.type === 'docker'  ? deployDockerPlan
               : app.type === 'python'  ? deployPythonPlan
               : app.type === 'npm'     ? deployNpmPlan
               : app.type === 'pypi'    ? deployPypiPlan
               : app.type === 'image'   ? deployImagePlan
               : deployNodePlan;
    const options: Record<string, unknown> = {
      allowDbDrop: body.allowDbDrop ?? false,
      envVars: body.envVars ?? {},
    };

    setImmediate(() => {
      orchestrator.run(app, deployment.id, plan, options).catch((err: unknown) => {
        fastify.log.error({ err, deploymentId: deployment.id }, 'Deployment failed unexpectedly');
      });
    });

    return reply.code(202).send({
      deploymentId: deployment.id,
      status: deployment.status,
      message: 'Deployment started',
    });
  });

  fastify.post('/apps/:appId/update', {
    schema: { params: appIdParam, body: deployBody },
    config: { rateLimit: DEPLOY_LIMIT },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    if (await deploymentSvc.hasRunningDeployment(appId)) {
      return reply.code(409).send({ error: 'A deployment is already running for this app' });
    }

    const body = (request.body ?? {}) as {
      triggeredBy?: 'api' | 'mcp';
      allowDbDrop?: boolean;
      envVars?: Record<string, string>;
    };
    const deployment = await deploymentSvc.create(appId, 'update', body.triggeredBy ?? 'api');
    const plan = app.type === 'compose' ? updateComposePlan
               : app.type === 'docker'  ? updateDockerPlan
               : app.type === 'python'  ? updatePythonPlan
               : app.type === 'npm'     ? updateNpmPlan
               : app.type === 'pypi'    ? updatePypiPlan
               : app.type === 'image'   ? updateImagePlan
               : updateNodePlan;
    const options: Record<string, unknown> = {
      allowDbDrop: body.allowDbDrop ?? false,
      envVars: body.envVars ?? {},
    };

    setImmediate(() => {
      orchestrator.run(app, deployment.id, plan, options).catch((err: unknown) => {
        fastify.log.error({ err, deploymentId: deployment.id }, 'Update failed unexpectedly');
      });
    });

    return reply.code(202).send({
      deploymentId: deployment.id,
      status: deployment.status,
      message: 'Update started',
    });
  });

  fastify.post('/deployments/:deploymentId/rollback', {
    schema: { params: deploymentIdParam },
    config: { rateLimit: DEPLOY_LIMIT },
  }, async (request, reply) => {
    const { deploymentId } = request.params as { deploymentId: string };
    const target = await deploymentSvc.findById(deploymentId);
    if (!target) return reply.code(404).send({ error: 'Deployment not found' });
    if (!request.isAdmin && request.scopedAppId !== target.appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (target.status !== 'success') {
      return reply.code(400).send({ error: 'Can only roll back a successful deployment' });
    }

    const app = await appSvc.findById(target.appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    const rollback = await deploymentSvc.create(target.appId, 'rollback', 'api');

    setImmediate(() => {
      orchestrator.rollbackDeployment(app, rollback.id, deploymentId).catch((err: unknown) => {
        fastify.log.error({ err, rollbackId: rollback.id }, 'Rollback failed unexpectedly');
      });
    });

    return reply.code(202).send({
      deploymentId: rollback.id,
      targetDeploymentId: deploymentId,
      status: rollback.status,
      message: 'Rollback started',
    });
  });

  fastify.post('/apps/:appId/rollback', {
    schema: { params: appIdParam },
    config: { rateLimit: DEPLOY_LIMIT },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    const last = await deploymentSvc.getLastSuccessful(appId);
    if (!last) return reply.code(404).send({ error: 'No successful deployment to roll back' });

    const rollback = await deploymentSvc.create(appId, 'rollback', 'api');

    setImmediate(() => {
      orchestrator.rollbackDeployment(app, rollback.id, last.id).catch((err: unknown) => {
        fastify.log.error({ err, rollbackId: rollback.id }, 'Rollback failed unexpectedly');
      });
    });

    return reply.code(202).send({
      deploymentId: rollback.id,
      targetDeploymentId: last.id,
      status: rollback.status,
      message: 'Rollback started',
    });
  });

  fastify.post('/apps/:appId/migrations/run', {
    schema: { params: appIdParam, body: migrateBody },
    config: { rateLimit: DEPLOY_LIMIT },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    const body = request.body as { direction: 'up' | 'down'; steps?: number };
    const migSvc = new MigrationService(fastify.log);
    const runner = await migSvc.detectRunner(app.deployPath);
    if (!runner) return reply.code(400).send({ error: 'No migration runner detected in app directory' });

    if (body.direction === 'up') {
      const applied = await migSvc.runUp(app.deployPath, runner);
      return { runner, direction: 'up', applied };
    } else {
      await migSvc.runDown(app.deployPath, runner, []);
      return { runner, direction: 'down' };
    }
  });
}
