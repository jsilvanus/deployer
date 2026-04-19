import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { RegistryService } from '../../services/registry.service.js';

export async function registryRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new RegistryService(fastify.log);

  fastify.post('/apps/:appId/registry/test', {
    schema: { params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } } },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const body = request.body as { provider?: string; target?: string; credentials?: Record<string, any> };
    if (!body?.provider || !body?.target) return reply.code(400).send({ error: 'provider and target are required' });
    const res = await svc.testCredentials(body.provider, body.target, body.credentials);
    return res;
  });
}

export default registryRoutes;
