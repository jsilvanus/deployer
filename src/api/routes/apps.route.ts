import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppService } from '../../services/app.service.js';
import { AppEnvService } from '../../services/app-env.service.js';
import {
  createAppBody,
  updateAppBody,
  appIdParam,
} from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { ConflictError } from '../../errors.js';

export async function appsRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new AppService(opts.db, opts.config.envEncryptionKey);

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
      name: string; type: 'node' | 'python' | 'docker' | 'compose'; repoUrl?: string;
      branch?: string; deployPath: string; composeContent?: string;
      primaryService?: string; dockerCompose?: boolean;
      nginxEnabled?: boolean; nginxLocation?: string;
      domain?: string; dbEnabled?: boolean; dbName?: string; port?: number;
    };

    if (body.type !== 'compose' && !body.repoUrl) {
      return reply.code(400).send({ error: 'repoUrl is required for node and docker apps' });
    }
    if (body.type === 'compose' && !body.composeContent) {
      return reply.code(400).send({ error: 'composeContent is required for compose apps' });
    }

    const allowedPaths = opts.config.allowedDeployPaths.split(',').map(p => resolve(p.trim()));
    const resolvedDeploy = resolve(body.deployPath);
    const isAllowed = allowedPaths.some(p => resolvedDeploy === p || resolvedDeploy.startsWith(p + '/'));
    if (!isAllowed) {
      return reply.code(400).send({
        error: `deployPath must be under one of: ${allowedPaths.join(', ')}`,
      });
    }

    try {
      const result = await svc.create(body);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      throw err;
    }
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
      composeContent?: string; primaryService?: string; branch?: string; domain?: string;
      nginxEnabled?: boolean; nginxLocation?: string; dbEnabled?: boolean; dbName?: string;
    };
    let app;
    try {
      app = await svc.update(appId, body);
    } catch (err) {
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      throw err;
    }
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

  // ── Per-app env vars ────────────────────────────────────────────────────────

  fastify.get('/apps/:appId/env', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await svc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    const envSvc = new AppEnvService(opts.db, opts.config.envEncryptionKey);
    const keys = await envSvc.listKeys(appId);
    return { appId, keys };
  });

  fastify.put('/apps/:appId/env', {
    schema: {
      params: appIdParam,
      body: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await svc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    const vars = request.body as Record<string, string>;
    const envSvc = new AppEnvService(opts.db, opts.config.envEncryptionKey);
    await envSvc.setMany(appId, vars);
    return reply.code(204).send();
  });

  fastify.delete('/apps/:appId/env/:key', {
    schema: {
      params: {
        type: 'object',
        required: ['appId', 'key'],
        properties: { appId: { type: 'string' }, key: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { appId, key } = request.params as { appId: string; key: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await svc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });
    const envSvc = new AppEnvService(opts.db, opts.config.envEncryptionKey);
    const deleted = await envSvc.delete(appId, key);
    if (!deleted) return reply.code(404).send({ error: 'Key not found' });
    return reply.code(204).send();
  });
}
