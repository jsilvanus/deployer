import type { FastifyInstance } from 'fastify';
import { AppService } from '../../services/app.service.js';
import { MetricsService } from '../../services/metrics.service.js';
import { deployments } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { appIdParam } from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';
import metricsRegistry from '../../services/metrics.registry.js';

function prometheusGauge(name: string, help: string, samples: string[]): string {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    ...samples,
  ].join('\n');
}

function label(app: string, type: string): string {
  return `app="${app.replace(/"/g, '\\"')}",type="${type}"`;
}

export async function metricsRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const appSvc = new AppService(opts.db, opts.config.envEncryptionKey);
  const metricsSvc = new MetricsService(opts.db, fastify.log);

  // ── Historical time-series ────────────────────────────────────────────────

  fastify.get('/apps/:appId/metrics', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    const query = request.query as { from?: string; to?: string };
    const to   = query.to   ? new Date(query.to)   : new Date();
    const from = query.from ? new Date(query.from)  : new Date(to.getTime() - 60 * 60 * 1000);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return reply.code(400).send({ error: 'Invalid from/to date' });
    }

    const points = await metricsSvc.query(appId, from, to);
    return { appId, appName: app.name, from: from.toISOString(), to: to.toISOString(), points };
  });

  // ── Prometheus exposition ─────────────────────────────────────────────────

  fastify.get('/metrics', async (request, reply) => {
    if (!request.isAdmin) return reply.code(403).send({ error: 'Admin access required' });

    const latest = await metricsSvc.latestPerApp();

    // Prefer prom-client registry output; populate fallback DB-derived gauges into registry first
    const runningRows = await opts.db.select().from(deployments).where(eq(deployments.status, 'running'));
    metricsRegistry.setGaugeValue('deployer_deployments_active', { }, runningRows.length);

    const ops: Array<'deploy' | 'update' | 'rollback'> = ['deploy', 'update', 'rollback'];
    for (const op of ops) {
      const totalRows = await opts.db.select().from(deployments).where(eq(deployments.operation, op));
      const failedRows = await opts.db.select().from(deployments).where(and(eq(deployments.operation, op), eq(deployments.status, 'failed')));
      metricsRegistry.setGaugeValue('deployer_deployments_total', { operation: op }, totalRows.length);
      metricsRegistry.setGaugeValue('deployer_deployments_failed_total', { operation: op }, failedRows.length);
    }

    for (const [, m] of latest) {
      const labels = { app: m.appName, type: m.appType } as Record<string, string>;
      metricsRegistry.setGaugeValue('deployer_app_status', { ...labels }, m.status === 'running' ? 1 : 0);
      metricsRegistry.setGaugeValue('deployer_app_updating', { ...labels }, m.status === 'updating' ? 1 : 0);
      metricsRegistry.setGaugeValue('deployer_app_cpu_percent', { ...labels }, m.cpu ?? 0);
      metricsRegistry.setGaugeValue('deployer_app_memory_mb', { ...labels }, m.memoryMb ?? 0);
      const state = (m.status ?? 'unknown');
      metricsRegistry.setGaugeValue('deployer_app_state', { ...labels, state }, 1);
    }

    const body = await metricsRegistry.getMetricsText();

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
  });
}
