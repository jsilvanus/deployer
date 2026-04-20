import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import metricsRegistry from '../../services/metrics.registry.js';

const TIMER_KEY = Symbol('metrics_timer');

async function metricsPlugin(fastify: FastifyInstance) {
  // Skip recording for the /metrics scrape itself to avoid recursion
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      const route = (request.routerPath ?? request.url ?? '/').toString();
      if (route === '/metrics') return;
      const labels = { method: request.method, route } as Record<string, string>;
      const hist = metricsRegistry.getOrCreateHistogram('http_request_duration_seconds', 'HTTP request duration in seconds', ['method', 'route']);
      const end = hist.startTimer(labels as any);
      // store end on request for onResponse
      (request as any)[TIMER_KEY] = end;
    } catch {
      // ignore metrics errors
    }
  });

  fastify.addHook('onResponse', async (request, reply) => {
    try {
      const route = (request.routerPath ?? request.url ?? '/').toString();
      if (route === '/metrics') return;
      const status = String(reply.statusCode ?? 0);
      const labels = { method: request.method, route, status } as Record<string, string>;
      try { metricsRegistry.getOrCreateCounter('http_requests_total', 'Total HTTP requests', ['method', 'route', 'status']).inc(labels, 1); } catch {}
      const end = (request as any)[TIMER_KEY] as (labels?: Record<string,string>) => void | undefined;
      try { if (end) end(); } catch {}
    } catch {
      // ignore metric errors
    }
  });
}

export default fp(metricsPlugin, { name: 'metrics-plugin' });
