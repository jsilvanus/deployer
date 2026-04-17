import type { FastifyInstance } from 'fastify';
import { AppService } from '../../services/app.service.js';
import {
  createAppBody,
  updateAppBody,
  appIdParam,
} from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';

export async function appsRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const svc = new AppService(opts.db);

  // Guard: admin-only or scoped-to-app read
  function requireAdmin(request: typeof fastify extends { get: unknown } ? never : never) {
    void request; // placeholder — handled inline per route
  }
  void requireAdmin;

  fastify.get('/apps', async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    return svc.list();
  });

  fastify.post('/apps', {
    schema: { body: createAppBody },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    const body = request.body as {
      name: string; type: 'node' | 'docker'; repoUrl: string;
      branch?: string; deployPath: string; dockerCompose?: boolean;
      nginxEnabled?: boolean; domain?: string; dbEnabled?: boolean; dbName?: string;
    };
    const result = await svc.create(body);
    return reply.code(201).send(result);
  });

  fastify.get('/apps/:appId', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await svc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    return app;
  });

  fastify.patch('/apps/:appId', {
    schema: { params: appIdParam, body: updateAppBody },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    const { appId } = request.params as { appId: string };
    const body = request.body as {
      branch?: string; domain?: string; nginxEnabled?: boolean;
      dbEnabled?: boolean; dbName?: string;
    };
    const app = await svc.update(appId, body);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    return app;
  });

  fastify.delete('/apps/:appId', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    const { appId } = request.params as { appId: string };
    const app = await svc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    await svc.delete(appId);
    return reply.code(204).send();
  });

  fastify.get('/apps/:appId/deployments', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await svc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    return svc.listDeployments(appId);
  });
}
