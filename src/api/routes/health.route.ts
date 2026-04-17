import type { FastifyInstance } from 'fastify';
import { VERSION } from '../../config/version.js';

const startTime = Date.now();

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
  }));
}
