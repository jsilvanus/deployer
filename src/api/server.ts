import Fastify, { type FastifyInstance } from 'fastify';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import authPlugin from './plugins/auth.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import rateLimitPlugin from './plugins/rate-limit.plugin.js';
import { healthRoutes } from './routes/health.route.js';
import { appsRoutes } from './routes/apps.route.js';
import { deploymentsRoutes } from './routes/deployments.route.js';
import { statusRoutes } from './routes/status.route.js';
import { logsRoutes } from './routes/logs.route.js';
import { metricsRoutes } from './routes/metrics.route.js';
import { setupRoutes } from './routes/setup.route.js';
import { MetricsService } from '../services/metrics.service.js';
import { createMcpServer } from '../mcp/server.js';
import { mountMcpTransport } from '../mcp/transport.js';
import type { Db } from '../db/client.js';
import type { Config } from '../config.js';

export async function createServer(config: Config, db: Db): Promise<FastifyInstance<Server, IncomingMessage, ServerResponse>> {
  const loggerOpts = process.env['NODE_ENV'] === 'development'
    ? { level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } }
    : { level: process.env['LOG_LEVEL'] ?? 'info' };

  const fastify = Fastify<Server, IncomingMessage, ServerResponse>({ logger: loggerOpts });

  await fastify.register(errorHandlerPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(authPlugin, { config, db });
  await fastify.register(healthRoutes);
  await fastify.register(appsRoutes, { db, config });
  await fastify.register(deploymentsRoutes, { db, config });
  await fastify.register(statusRoutes, { db, config });
  await fastify.register(logsRoutes, { db, config });
  await fastify.register(metricsRoutes, { db, config });
  await fastify.register(setupRoutes, { db, config });

  // Start metrics poller after server is ready; stop on close
  fastify.addHook('onReady', async () => {
    const svc = new MetricsService(db, fastify.log);
    const timer = svc.startPoller();
    fastify.addHook('onClose', async () => clearInterval(timer));
  });

  // Mount MCP server on /mcp (skip auth middleware — MCP handles its own token)
  const mcpServer = createMcpServer(db, config, fastify.log);
  await mountMcpTransport(fastify, mcpServer);

  return fastify;
}
