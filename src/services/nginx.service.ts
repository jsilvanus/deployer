import { readFile, writeFile, unlink, symlink, access, mkdir } from 'node:fs/promises';
import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';

export class NginxService {
  constructor(private logger: AnyLogger) {}

  configPath(appName: string): string {
    return `${SITES_AVAILABLE}/${appName}`;
  }

  symlinkPath(appName: string): string {
    return `${SITES_ENABLED}/${appName}`;
  }

  async exists(appName: string): Promise<boolean> {
    try {
      await access(this.configPath(appName));
      return true;
    } catch {
      return false;
    }
  }

  async read(appName: string): Promise<string | null> {
    try {
      return await readFile(this.configPath(appName), 'utf8');
    } catch {
      return null;
    }
  }

  generateBlock(opts: {
    appName: string;
    domain: string;
    upstreamPort: number;
  }): string {
    return `server {
    listen 80;
    server_name ${opts.domain};

    location / {
        proxy_pass http://127.0.0.1:${opts.upstreamPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
  }

  async write(appName: string, config: string): Promise<void> {
    this.logger.info({ appName }, 'writing nginx config');
    await mkdir(SITES_AVAILABLE, { recursive: true });
    await writeFile(this.configPath(appName), config, 'utf8');
    await this.enableSite(appName);
  }

  async restore(appName: string, previousConfig: string | null): Promise<void> {
    if (!previousConfig) {
      await this.remove(appName);
      return;
    }
    this.logger.info({ appName }, 'restoring nginx config');
    await writeFile(this.configPath(appName), previousConfig, 'utf8');
    await this.reload();
  }

  async remove(appName: string): Promise<void> {
    try { await unlink(this.symlinkPath(appName)); } catch { /* ok */ }
    try { await unlink(this.configPath(appName)); } catch { /* ok */ }
    await this.reload();
  }

  async enableSite(appName: string): Promise<void> {
    await mkdir(SITES_ENABLED, { recursive: true });
    try { await unlink(this.symlinkPath(appName)); } catch { /* ok if not exists */ }
    await symlink(this.configPath(appName), this.symlinkPath(appName));
    await this.reload();
  }

  async validate(): Promise<boolean> {
    try {
      await execa('nginx', ['-t']);
      return true;
    } catch {
      return false;
    }
  }

  async reload(): Promise<void> {
    this.logger.info('reloading nginx');
    await execa('nginx', ['-s', 'reload']);
  }
}
