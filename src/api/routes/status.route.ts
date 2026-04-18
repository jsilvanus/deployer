import type { FastifyInstance } from 'fastify';
import { AppService } from '../../services/app.service.js';
import { Pm2Service } from '../../services/pm2.service.js';
import { DockerService } from '../../services/docker.service.js';
import { appIdParam } from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';

export async function statusRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const appSvc = new AppService(opts.db, opts.config.envEncryptionKey);
  const pm2 = new Pm2Service(fastify.log);
  const docker = new DockerService(fastify.log);

  fastify.get('/apps/:appId/status', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    if (app.type === 'node' || app.type === 'python') {
      const info = await pm2.status(app.name);
      return {
        appId: app.id,
        appName: app.name,
        type: 'node',
        status: info?.status ?? 'not_found',
        pid: info?.pid ?? null,
        memory: info?.memory ?? null,
        cpu: info?.cpu ?? null,
        uptime: info?.uptime ?? null,
      };
    } else {
      const containerName = app.name;
      const containerStatus = await docker.containerStatus(containerName);
      return {
        appId: app.id,
        appName: app.name,
        type: 'docker',
        status: containerStatus ?? 'not_found',
      };
    }
  });
}
