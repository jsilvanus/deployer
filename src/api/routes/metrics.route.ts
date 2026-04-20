import type { FastifyInstance } from 'fastify';
import { AppService } from '../../services/app.service.js';
import { MetricsService } from '../../services/metrics.service.js';
import { deployments } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { appIdParam } from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';

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

    // Add DB-derived deployment metrics (fallback counters/gauges)
    const runningRows = await opts.db.select().from(deployments).where(eq(deployments.status, 'running'));
    const deploymentsActiveSamples: string[] = [];
    const tsNow = Math.floor(Date.now());
    deploymentsActiveSamples.push(`deployer_deployments_active ${runningRows.length} ${tsNow}`);

    const deploymentTotalSamples: string[] = [];
    const deploymentFailedSamples: string[] = [];
    const ops: Array<'deploy' | 'update' | 'rollback'> = ['deploy', 'update', 'rollback'];
    for (const op of ops) {
      const totalRows = await opts.db.select().from(deployments).where(eq(deployments.operation, op));
      const failedRows = await opts.db.select().from(deployments).where(and(eq(deployments.operation, op), eq(deployments.status, 'failed')));
      deploymentTotalSamples.push(`deployer_deployments_total{operation="${op}"} ${totalRows.length} ${tsNow}`);
      deploymentFailedSamples.push(`deployer_deployments_failed_total{operation="${op}"} ${failedRows.length} ${tsNow}`);
    }

    const statusSamples: string[] = [];
    const cpuSamples: string[] = [];
    const memSamples: string[] = [];
    const stateSamples: string[] = [];
    const updatingSamples: string[] = [];

    for (const [, m] of latest) {
      const l = label(m.appName, m.appType);
      const ts = m.timestamp * 1000;
      statusSamples.push(`deployer_app_status{${l}} ${m.status === 'running' ? 1 : 0} ${ts}`);
      // labelled state metric (canonical enumerated state)
      const state = (m.status ?? 'unknown').replace(/"/g, '\\"');
      stateSamples.push(`deployer_app_state{${l},state="${state}"} 1 ${ts}`);
      // convenience boolean gauge for 'updating' to simplify alerting
      updatingSamples.push(`deployer_app_updating{${l}} ${m.status === 'updating' ? 1 : 0} ${ts}`);
      if (m.cpu != null)      cpuSamples.push(`deployer_app_cpu_percent{${l}} ${m.cpu.toFixed(2)} ${ts}`);
      if (m.memoryMb != null) memSamples.push(`deployer_app_memory_mb{${l}} ${m.memoryMb.toFixed(2)} ${ts}`);
    }

    const body = [
      prometheusGauge('deployer_deployments_active', 'Number of running deployments', deploymentsActiveSamples),
      prometheusGauge('deployer_deployments_total', 'Total deployments by operation', deploymentTotalSamples),
      prometheusGauge('deployer_deployments_failed_total', 'Failed deployments by operation', deploymentFailedSamples),
      // deployment DB-derived metrics above; app-level metrics below
      prometheusGauge('deployer_app_state',
        'Current app state (labelled: state="running"|"updating"|...)',
        stateSamples),
      prometheusGauge('deployer_app_updating',
        '1=updating',
        updatingSamples),
      prometheusGauge('deployer_app_status',
        'Current app status: 1=running 0=other',
        statusSamples),
      prometheusGauge('deployer_app_cpu_percent',
        'CPU usage percent (averaged across services for docker/compose)',
        cpuSamples),
      prometheusGauge('deployer_app_memory_mb',
        'Memory usage in MiB (summed across services for docker/compose)',
        memSamples),
    ].join('\n\n') + '\n';

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(body);
  });
}
