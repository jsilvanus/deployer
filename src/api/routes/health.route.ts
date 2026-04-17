import type { FastifyInstance } from 'fastify';

const startTime = Date.now();

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
  }));
}
