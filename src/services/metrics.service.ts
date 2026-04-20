import { randomUUID } from 'node:crypto';
import { eq, and, gte, lte, lt, desc } from 'drizzle-orm';
import { appMetrics, apps } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { AnyLogger } from '../types/logger.js';
import { Pm2Service } from './pm2.service.js';
import { DockerService } from './docker.service.js';
import metricsRegistry from './metrics.registry.js';

export interface MetricPoint {
  timestamp: number;
  status: string;
  cpu: number | null;
  memoryMb: number | null;
}

function parseMemoryMb(memUsage: string): number | null {
  const match = /^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/i.exec(memUsage.trim());
  if (!match) return null;
  const multipliers: Record<string, number> = {
    b: 1 / (1024 * 1024), kib: 1 / 1024, mib: 1, gib: 1024, tib: 1024 * 1024,
  };
  return parseFloat(match[1]!) * (multipliers[match[2]!.toLowerCase()] ?? 1);
}

export class MetricsService {
  constructor(private db: Db, private logger: AnyLogger) {}

  async sample(): Promise<void> {
    const allApps = await this.db.select().from(apps);
    const now = Math.floor(Date.now() / 1000);
    const rows: Array<typeof appMetrics.$inferInsert> = [];

    for (const app of allApps) {
      try {
        let status = 'unknown';
        let cpu: number | null = null;
        let memoryMb: number | null = null;

        if (app.type === 'node' || app.type === 'python') {
          const info = await new Pm2Service(this.logger).status(app.name);
          status = info?.status ?? 'not_found';
          cpu = info?.cpu ?? null;
          memoryMb = info != null ? info.memory / (1024 * 1024) : null;
        } else {
          const docker = new DockerService(this.logger);
          const ps = await docker.composePsStatus(app.deployPath);
          status = ps.status;
          const stats = await docker.composeStats(app.deployPath);
          if (stats.length > 0) {
            cpu = stats.reduce((s, r) => s + r.cpu, 0) / stats.length;
            const mems = stats
              .map(r => parseMemoryMb(r.memory))
              .filter((m): m is number => m != null);
            memoryMb = mems.length > 0 ? mems.reduce((a, b) => a + b, 0) : null;
          }
        }

        rows.push({ id: randomUUID(), appId: app.id, timestamp: now, status, cpu, memoryMb });

        // Export app-level metrics into prom-client registry for scraping
        try {
          const labels = { app: app.name, type: app.type } as Record<string, string>;
          metricsRegistry.setGaugeValue('deployer_app_status', labels, status === 'running' ? 1 : 0);
          metricsRegistry.setGaugeValue('deployer_app_updating', labels, status === 'updating' ? 1 : 0);
          if (cpu != null) metricsRegistry.setGaugeValue('deployer_app_cpu_percent', labels, cpu);
          if (memoryMb != null) metricsRegistry.setGaugeValue('deployer_app_memory_mb', labels, memoryMb);
          metricsRegistry.setGaugeValue('deployer_app_state', { ...labels, state: status }, 1);
        } catch {
          // non-fatal
        }
      } catch (err) {
        this.logger.warn({ err, appId: app.id }, 'metrics sample failed for app');
      }
    }

    if (rows.length > 0) {
      await this.db.insert(appMetrics).values(rows);
    }
  }

  async query(appId: string, from: Date, to: Date): Promise<MetricPoint[]> {
    const rows = await this.db
      .select()
      .from(appMetrics)
      .where(and(
        eq(appMetrics.appId, appId),
        gte(appMetrics.timestamp, Math.floor(from.getTime() / 1000)),
        lte(appMetrics.timestamp, Math.floor(to.getTime() / 1000)),
      ))
      .orderBy(appMetrics.timestamp);
    return rows.map(r => ({
      timestamp: r.timestamp,
      status:    r.status,
      cpu:       r.cpu,
      memoryMb:  r.memoryMb,
    }));
  }

  async latestPerApp(): Promise<Map<string, { appName: string; appType: string } & MetricPoint>> {
    const allApps = await this.db.select().from(apps);
    const result = new Map<string, { appName: string; appType: string } & MetricPoint>();
    for (const app of allApps) {
      const [row] = await this.db
        .select()
        .from(appMetrics)
        .where(eq(appMetrics.appId, app.id))
        .orderBy(desc(appMetrics.timestamp))
        .limit(1);
      if (row) {
        result.set(app.id, {
          appName:   app.name,
          appType:   app.type,
          timestamp: row.timestamp,
          status:    row.status,
          cpu:       row.cpu,
          memoryMb:  row.memoryMb,
        });
      }
    }
    return result;
  }

  async cleanup(): Promise<void> {
    const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    await this.db.delete(appMetrics).where(lt(appMetrics.timestamp, cutoff));
  }

  startPoller(intervalMs = 30_000): NodeJS.Timeout {
    void this.cleanup().catch(err => this.logger.warn({ err }, 'metrics cleanup failed'));
    void this.sample().catch(err => this.logger.warn({ err }, 'initial metrics sample failed'));
    return setInterval(() => {
      void this.sample().catch(err => this.logger.warn({ err }, 'metrics sample failed'));
      // Run cleanup once per day (every 2880 ticks at 30s interval)
      if (Math.floor(Date.now() / 1000) % (24 * 60 * 60) < intervalMs / 1000) {
        void this.cleanup().catch(err => this.logger.warn({ err }, 'metrics cleanup failed'));
      }
    }, intervalMs);
  }
}
