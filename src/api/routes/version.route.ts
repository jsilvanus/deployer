import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { VersionService } from '../../services/version.service.js';
import { deployments } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export async function versionRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new VersionService(opts.db, opts.config.versionUpstreamUrl, (opts.config.versionCheckCacheTtlSeconds ?? 3600) * 1000);

  fastify.get('/apps/:appId/version', {
    schema: {
      params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const local = await svc.getLocalVersion(appId);
    return { appId, version: local };
  });

  fastify.get('/apps/:appId/version/latest', {
    schema: {
      params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } },
      querystring: { type: 'object', properties: { refresh: { type: 'boolean' } } },
    },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const refresh = Boolean((request.query as any)?.refresh);
    const local = await svc.getLocalVersion(appId);
    const latest = await svc.getLatest(appId, refresh);
    const upgradeAvailable = !!(latest && local && latest.version !== local);
    return { deployed: local ? { version: local } : null, latest, upgradeAvailable };
  });

  fastify.get('/apps/:appId/versions', {
    schema: {
      params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } },
      querystring: { type: 'object', properties: { limit: { type: 'integer' }, cursor: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const q = request.query as any;
    const limit = Math.min(100, q?.limit ? Number(q.limit) : 20);
    const rows = await opts.db.select().from(deployments).where(eq(deployments.appId, appId)).limit(limit);
    const items = Array.isArray(rows) ? rows.map(r => ({ id: r.id, version: r.gitCommitAfter ?? r.gitCommitBefore ?? r.operation, source: 'git', ref: r.gitCommitAfter ?? r.gitCommitBefore, deployedAt: r.createdAt, deployedBy: r.triggeredBy })) : [];
    return { items, nextCursor: '' };
  });
}

export default versionRoutes;
