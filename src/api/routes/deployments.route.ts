import type { FastifyInstance } from 'fastify';
import { DeploymentService } from '../../services/deployment.service.js';
import { AppService } from '../../services/app.service.js';
import { MigrationService } from '../../services/migration.service.js';
import { DeploymentOrchestrator } from '../../core/orchestrator.js';
import { deploymentIdParam, deployBody, migrateBody } from '../schemas/deployment.schema.js';
import { appIdParam } from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { deployNodePlan } from '../../core/plans/deploy-node.plan.js';
import { updateNodePlan } from '../../core/plans/update-node.plan.js';
import { deployDockerPlan } from '../../core/plans/deploy-docker.plan.js';
import { updateDockerPlan } from '../../core/plans/update-docker.plan.js';

export async function deploymentsRoutes(
  fastify: FastifyInstance,
  opts: { db: Db; config: Config },
) {
  const deploymentSvc = new DeploymentService(opts.db);
  const appSvc = new AppService(opts.db);
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
    const deployment = await deploymentSvc.findById(deploymentId);
    if (!deployment) return reply.code(404).send({ error: 'Deployment not found' });
    if (!request.isAdmin && request.scopedAppId !== deployment.appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    return deployment;
  });

  fastify.get('/deployments/:deploymentId/snapshots', {
    schema: { params: deploymentIdParam },
  }, async (request, reply) => {
    const { deploymentId } = request.params as { deploymentId: string };
    const deployment = await deploymentSvc.findById(deploymentId);
    if (!deployment) return reply.code(404).send({ error: 'Deployment not found' });
    if (!request.isAdmin && request.scopedAppId !== deployment.appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    return deploymentSvc.getSnapshots(deploymentId);
  });

  fastify.post('/apps/:appId/deploy', {
    schema: { params: appIdParam, body: deployBody },
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
    const plan = app.type === 'docker' ? deployDockerPlan : deployNodePlan;
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
    const plan = app.type === 'docker' ? updateDockerPlan : updateNodePlan;
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
