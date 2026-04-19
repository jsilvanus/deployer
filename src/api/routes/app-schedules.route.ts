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
    schema: { params: { type: 'object', required: ['appId'], properties: { appId: { type: 'string' } } } },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) return reply.code(403).send({ error: 'Forbidden' });
    const body = request.body as any;
    const id = await svc.create({ appId, type: body.type, cron: body.cron, payload: body.payload, createdBy: request.isAdmin ? 'admin' : (request.scopedAppId ?? 'unknown') });
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
