import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { ScheduleService } from '../../services/schedule.service.js';

export async function appSchedulesRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new ScheduleService(opts.db);

  fastify.get('/apps/:appId/schedules', {
    schema: { params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } } },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    return svc.listForApp(appId);
  });

  fastify.post('/apps/:appId/schedules', {
    schema: {
      params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } },
      body: { type: 'object', required: ['type','cron'], properties: { type: { type: 'string' }, cron: { type: 'string' }, payload: { type: 'object' }, timezone: { type: 'string' } }, additionalProperties: false }
    },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const body = request.body as any;
    // Disallow unsafe `command` runtime for non-admin callers
    const runSpec = body?.payload?.runSpec ?? null;
    if (runSpec && runSpec.runtime === 'command' && !request.isAdmin) return reply.code(403).send({ error: 'Admin access required for command runtime' });
    const id = await svc.create({ appId, type: body.type, cron: body.cron, payload: body.payload, timezone: body.timezone, createdBy: request.isAdmin ? 'admin' : (request.scopedAppId ?? 'unknown') });
    return reply.code(201).send({ id });
  });

  fastify.delete('/apps/:appId/schedules/:id', async (request, reply) => {
    const { appId, id } = request.params as any;
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    await svc.delete(id);
    return reply.code(204).send();
  });
}

export default appSchedulesRoutes;
