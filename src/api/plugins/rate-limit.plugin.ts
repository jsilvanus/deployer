import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

// Two tiers used across routes:
//   DEPLOY_MAX  — heavy mutation endpoints (deploy, update, rollback, migrations)
//   SETUP_MAX   — admin-only setup endpoints (traefik, self-register, self-update)
//   Default     — all other routes (reads, status, logs)
export const DEPLOY_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
export const SETUP_LIMIT  = { max: 5,  timeWindow: '1 minute' } as const;

async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    // Key by bearer token when present so limits are per-credential, not per-IP.
    // Falls back to IP for unauthenticated paths (e.g. /health).
    keyGenerator(request) {
      const auth = request.headers['authorization'];
      if (auth?.startsWith('Bearer ')) return auth.slice(7);
      return request.ip;
    },
    errorResponseBuilder(_request, context) {
      return {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${context.after}.`,
      };
    },
  });
}

export default fp(rateLimitPlugin, { name: 'rate-limit' });
