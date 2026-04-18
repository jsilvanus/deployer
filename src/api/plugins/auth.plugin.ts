import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { apps } from '../../db/schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    isAdmin: boolean;
    scopedAppId?: string;
  }
}

async function authPlugin(
  fastify: FastifyInstance,
  opts: { config: Config; db: Db },
) {
  fastify.decorateRequest('isAdmin', false);
  fastify.decorateRequest('scopedAppId', undefined);

  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for health check
    if (request.routeOptions.url === '/health') return;

    const header = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Bearer token' });
    }

    const token = header.slice(7);

    // Admin token check (constant-time compare via hash)
    const adminHash = createHash('sha256').update(opts.config.adminToken).digest('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    if (adminHash === tokenHash) {
      request.isAdmin = true;
      return;
    }

    // Per-app key check
    const keyHash = createHash('sha256').update(token).digest('hex');
    const [app] = await opts.db
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.apiKeyHash, keyHash))
      .limit(1);

    if (!app) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    request.scopedAppId = app.id;
  });
}

export default fp(authPlugin, { name: 'auth' });
