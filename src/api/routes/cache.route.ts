import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { apps } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export async function cacheRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  fastify.post('/apps/:appId/cache/purge', {
    schema: { params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } } },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const body = request.body as { target?: string; paths?: string[] } | undefined;
    // For now: clear last-modified cache entry for this app if any and record op
    // Real CDN/proxy purge integration requires provider credentials — admin-only in follow-up
    const opId = randomUUID();
    // touch apps.lastModified to now
    await opts.db.update(apps).set({ lastModified: new Date() }).where(eq(apps.id, appId));
    return reply.code(202).send({ operationId: opId, status: 'scheduled' });
  });
}

export default cacheRoutes;
