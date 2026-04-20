import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import { ScheduleService } from '../../services/schedule.service.js';
import { scheduleRuns } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export async function schedulesRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const svc = new ScheduleService(opts.db);

  fastify.post('/schedules', {
    schema: { body: { type: 'object', required: ['appId','type','cron'], properties: { appId: { type: 'string' }, type: { type: 'string' }, cron: { type: 'string' }, payload: { type: 'object' } } } },
  }, async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    const body = request.body as any;
    const id = await svc.create({ appId: body.appId, type: body.type, cron: body.cron, payload: body.payload, createdBy: request.isAdmin ? 'admin' : (request.scopedAppId ?? 'unknown') });
    return reply.code(201).send({ id });
  });

  fastify.get('/schedules', async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    return svc.listAll();
  });

  fastify.delete('/schedules/:id', async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    const { id } = request.params as any;
    await svc.delete(id);
    return reply.code(204).send();
  });

  fastify.get('/schedules/:id/runs', async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
    const { id } = request.params as any;
    const rows = await opts.db.select().from(scheduleRuns).where(eq(scheduleRuns.scheduleId, id));
    return rows;
  });
}

export default schedulesRoutes;
