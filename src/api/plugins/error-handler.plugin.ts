import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation error',
        details: error.errors,
      });
    }

    fastify.log.error(error);

    const statusCode = error.statusCode ?? 500;
    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : error.message,
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
