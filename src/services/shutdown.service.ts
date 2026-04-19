import { Pm2Service } from './pm2.service.js';
import { DockerService } from './docker.service.js';
import type { Db } from '../db/client.js';
import type { AnyLogger } from '../types/logger.js';
import { randomUUID } from 'node:crypto';

export class ShutdownService {
  private pm2 = new Pm2Service(console);
  private docker = new DockerService(console);

  constructor(private db: Db, private config: any, private logger: AnyLogger) {}

  async perform(appId: string, action: string, opts: { actor?: string }): Promise<{ operationId: string; status: string }> {
    const opId = randomUUID();
    this.logger.info({ appId, action, opId }, 'shutdown.perform');
    // Load app to determine runtime
    const rows = await this.db.select().from('apps' as any).where({ id: appId }).limit(1);
    const app = Array.isArray(rows) ? rows[0] : rows;
    if (!app) throw new Error('App not found');

    try {
      if (app.type === 'node' || app.type === 'python') {
        const serviceName = app.primaryService ?? app.name;
        if (action === 'stop') await this.pm2.stop(serviceName);
        else if (action === 'restart') await this.pm2.restart(serviceName);
        else if (action === 'graceful') await this.pm2.reload(serviceName);
        else if (action === 'destroy') await this.pm2.delete(serviceName);
      } else if (app.type === 'docker' || app.type === 'compose') {
        const path = app.deployPath;
        if (action === 'stop' || action === 'destroy' || action === 'graceful') {
          await this.docker.composeDown(path);
        }
      }
      // record a simple shutdown log
      await this.db.insert('shutdown_logs' as any).values({ id: randomUUID(), initiatedBy: opts.actor ?? 'unknown', dryRun: 0, deleted: action === 'destroy' ? 1 : 0, details: JSON.stringify({ action }), createdAt: Math.floor(Date.now() / 1000) });
      return { operationId: opId, status: 'accepted' };
    } catch (err: any) {
      this.logger.error({ err: String(err) }, 'shutdown failed');
      return { operationId: opId, status: 'failed' };
    }
  }
}

export default ShutdownService;
