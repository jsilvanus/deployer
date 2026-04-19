import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Db } from '../db/client.js';
import { shutdownLogs } from '../db/schema.js';
import { AppService } from './app.service.js';
import { Pm2Service } from './pm2.service.js';
import { DockerService } from './docker.service.js';

export class SelfShutdownService {
  constructor(private db: Db, private config: any, private logger: any) {}

  async dryRun() {
    const apps = await new AppService(this.db, this.config.envEncryptionKey).list();
    const plan = apps.map(a => ({ app: a.name, type: a.type, deployPath: a.deployPath }));
    return plan;
  }

  async execute(options: { deleteInstalled?: boolean; initiatedBy?: string }) {
    if (!this.config.allowSelfShutdown) throw new Error('Self-shutdown disabled by configuration');
    const apps = await new AppService(this.db, this.config.envEncryptionKey).list();
    const pm2 = new Pm2Service(this.logger);
    const docker = new DockerService(this.logger);
    const results: any[] = [];
    for (const app of apps) {
      try {
        if (app.type === 'node' || app.type === 'python') {
          await pm2.delete(app.name);
        } else {
          try {
            await docker.composeDown(app.deployPath);
          } catch {
            // ignore
          }
        }

        if (options.deleteInstalled && this.config.allowSelfShutdownDelete) {
          try {
            await rm(app.deployPath, { recursive: true, force: true });
            results.push({ app: app.name, deleted: true });
          } catch (err) {
            results.push({ app: app.name, deleted: false, error: String(err) });
          }
        } else {
          results.push({ app: app.name, stopped: true });
        }
      } catch (err) {
        results.push({ app: app.name, error: String(err) });
      }
    }

    // record audit log
    const now = new Date();
    await this.db.insert(shutdownLogs).values({
      id: randomUUID(), initiatedBy: options.initiatedBy ?? 'admin', dryRun: 0, deleted: options.deleteInstalled ? 1 : 0, details: JSON.stringify(results), createdAt: now,
    });

    return results;
  }
}

export default SelfShutdownService;
