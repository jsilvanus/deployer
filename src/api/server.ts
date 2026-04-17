import Fastify, { type FastifyInstance } from 'fastify';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import authPlugin from './plugins/auth.plugin.js';
import errorHandlerPlugin from './plugins/error-handler.plugin.js';
import { healthRoutes } from './routes/health.route.js';
import { appsRoutes } from './routes/apps.route.js';
import { deploymentsRoutes } from './routes/deployments.route.js';
import { statusRoutes } from './routes/status.route.js';
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
  await fastify.register(authPlugin, { config, db });
  await fastify.register(healthRoutes);
  await fastify.register(appsRoutes, { db });
  await fastify.register(deploymentsRoutes, { db, config });
  await fastify.register(statusRoutes, { db });

  // Mount MCP server on /mcp (skip auth middleware — MCP handles its own token)
  const mcpServer = createMcpServer(db, config, fastify.log);
  await mountMcpTransport(fastify, mcpServer);

  return fastify;
}
