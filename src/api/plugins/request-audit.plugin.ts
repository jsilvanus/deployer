import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { requestLogs } from '../../db/schema.js';
import { runExclusive } from '../../db/client.js';

export default fp(async function requestAudit(fastify: FastifyInstance, opts: any) {
  const db = opts.db;
  if (!db) {
    fastify.log.warn('request-audit plugin loaded without db reference; skipping');
    return;
  }

  fastify.addHook('onResponse', async (request, reply) => {
    try {
      const now = new Date();
      const method = request.method;
      const path = request.url;
      const headers = { 'x-request-id': request.headers['x-request-id'], 'x-cli-version': request.headers['x-cli-version'], authorization: request.headers['authorization'] ? 'REDACTED' : null };
      let body = '';
      try { body = request.body ? JSON.stringify(request.body) : ''; } catch { body = ''; }
      const rawAuth = request.headers['authorization'];
      const token = typeof rawAuth === 'string' && rawAuth.startsWith('Bearer ')
        ? createHash('sha256').update(rawAuth.slice(7)).digest('hex').slice(0, 32)
        : null;
      await runExclusive(async () => db.insert(requestLogs).values({ id: randomUUID(), method, path, headers: JSON.stringify(headers), body: body ? (body.length > 2000 ? body.slice(0,2000) + '...(truncated)' : body) : null, statusCode: reply.statusCode, tokenInfo: token, createdAt: now }));
    } catch (err) {
      // Never fail request because audit logging failed
      fastify.log.warn('Failed to write request audit log: %s', String(err));
    }
  });
});
