import Fastify, { type FastifyInstance } from 'fastify';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import cors from '@fastify/cors';
import authPlugin from './plugins/auth.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import rateLimitPlugin from './plugins/rate-limit.plugin.js';
import { LastModifiedCache } from '../cache/last-modified.cache.js';
import { healthRoutes } from './routes/health.route.js';
import { appsRoutes } from './routes/apps.route.js';
import { deploymentsRoutes } from './routes/deployments.route.js';
import { statusRoutes } from './routes/status.route.js';
import { logsRoutes } from './routes/logs.route.js';
import { metricsRoutes } from './routes/metrics.route.js';
import { setupRoutes } from './routes/setup.route.js';
import { versionRoutes } from './routes/version.route.js';
import { schedulesRoutes } from './routes/schedules.route.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { MetricsService } from '../services/metrics.service.js';
import { createMcpServer, createAndRegisterMcpServer } from '../mcp/server.js';
import { mountMcpTransport } from '../mcp/transport.js';
import type { Db } from '../db/client.js';
import type { Config } from '../config.js';

export async function createServer(config: Config, db: Db): Promise<FastifyInstance<Server, IncomingMessage, ServerResponse>> {
  const loggerOpts = process.env['NODE_ENV'] === 'development'
    ? { level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } }
    : { level: process.env['LOG_LEVEL'] ?? 'info' };

  const fastify = Fastify<Server, IncomingMessage, ServerResponse>({ logger: loggerOpts });
  const cache = new LastModifiedCache();

  await fastify.register(errorHandlerPlugin);
  await fastify.register(rateLimitPlugin);

  if (config.corsOrigins) {
    const origins = config.corsOrigins.split(',').map(o => o.trim()).filter(Boolean);
    await fastify.register(cors, { origin: origins });
  }
  await fastify.register(authPlugin, { config, db });
  await fastify.register(healthRoutes);
  await fastify.register(appsRoutes, { db, config, cache });
  await fastify.register(deploymentsRoutes, { db, config, cache });
  await fastify.register(statusRoutes, { db, config });
  await fastify.register(logsRoutes, { db, config });
  await fastify.register(metricsRoutes, { db, config });
  await fastify.register(setupRoutes, { db, config, cache });
  await fastify.register(versionRoutes, { db, config });
  await fastify.register(schedulesRoutes, { db, config });

  // Start metrics poller after server is ready; stop on close
  fastify.addHook('onReady', async () => {
    const svc = new MetricsService(db, fastify.log);
    const timer = svc.startPoller();
    fastify.addHook('onClose', async () => clearInterval(timer));
    if (config.schedulerEnabled) {
      const scheduler = new SchedulerService(db, config, fastify.log);
      scheduler.start();
      fastify.addHook('onClose', async () => scheduler.stop());
    }
  });

  // Mount MCP server on /mcp (skip auth middleware — MCP handles its own token)
  const mcpServer = createAndRegisterMcpServer(db, config, fastify.log);
  await mountMcpTransport(fastify, mcpServer);

  return fastify;
}
