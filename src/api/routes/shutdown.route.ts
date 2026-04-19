import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { ShutdownService } from '../../services/shutdown.service.js';

export async function shutdownRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new ShutdownService(opts.db, opts.config, fastify.log);

  fastify.post('/apps/:appId/shutdown', {
    schema: { params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } } },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    const body = request.body as { action?: 'stop' | 'restart' | 'graceful' | 'destroy' };
    const action = body?.action ?? 'stop';
    // Authorization: non-destructive allowed for app keys; destructive requires admin
    if (action === 'destroy') {
      if (!request.isAdmin) return reply.code(403).send({ error: 'Admin required for destroy' });
      if (!opts.config.allowSelfShutdownDelete) return reply.code(403).send({ error: 'Destructive shutdown disabled by config' });
    } else {
      if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    }

    const op = await svc.perform(appId, action, { actor: request.isAdmin ? 'admin' : (request.scopedAppId ?? 'unknown') });
    return reply.code(202).send(op);
  });
}

export default shutdownRoutes;
