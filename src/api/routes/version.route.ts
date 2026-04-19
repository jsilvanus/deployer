import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { VersionService } from '../../services/version.service.js';

export async function versionRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new VersionService(opts.db, opts.config.versionUpstreamUrl);

  fastify.get('/apps/:appId/version', {
    schema: {
      params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const local = await svc.getLocalVersion(appId);
    const upstream = await svc.getUpstreamLatest(appId);
    return { appId, localVersion: local, upstream };
  });
}

export default versionRoutes;
