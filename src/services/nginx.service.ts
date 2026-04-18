import { access, readdir, readFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';

const LE_BASE = '/etc/letsencrypt/live';
const LE_OPTIONS_CONF = '/etc/letsencrypt/options-ssl-nginx.conf';
const LE_DHPARAM = '/etc/letsencrypt/ssl-dhparams.pem';

// First line added to every deployer-generated nginx config.
// Used by findExternalConflict to distinguish deployer configs from others.
const DEPLOYER_MARKER = '# deployer-managed';

export type SslConfig = {
  certPath: string;
  keyPath: string;
  optionsSslConf: string | null;
  dhparamPath: string | null;
};

async function fileExists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

export class NginxService {
  constructor(private logger: AnyLogger) {}

  configPath(appName: string): string {
    return `${SITES_AVAILABLE}/${appName}`;
  }

  symlinkPath(appName: string): string {
    return `${SITES_ENABLED}/${appName}`;
  }

  async exists(appName: string): Promise<boolean> {
    return fileExists(this.configPath(appName));
  }

  async read(appName: string): Promise<string | null> {
    try {
      const result = await execa('cat', [this.configPath(appName)]);
      return result.stdout;
    } catch {
      return null;
    }
  }

  // Returns SSL paths if a Let's Encrypt certificate exists for the domain.
  // Returns null if no cert is found — caller should fall back to plain HTTP.
  async detectSsl(domain: string): Promise<SslConfig | null> {
    const certPath = `${LE_BASE}/${domain}/fullchain.pem`;
    const keyPath  = `${LE_BASE}/${domain}/privkey.pem`;

    if (!await fileExists(certPath) || !await fileExists(keyPath)) return null;

    return {
      certPath,
      keyPath,
      optionsSslConf: await fileExists(LE_OPTIONS_CONF) ? LE_OPTIONS_CONF : null,
      dhparamPath:    await fileExists(LE_DHPARAM)      ? LE_DHPARAM      : null,
    };
  }

  // Scans /etc/nginx/sites-enabled for any config that already claims
  // domain+location. Returns null if clear, or a conflict descriptor.
  // Pass ownAppName to treat that app's own existing config as non-conflicting.
  async findExternalConflict(
    domain: string,
    location: string,
    ownAppName: string,
  ): Promise<{ file: string; ownedByDeployer: boolean; ownerAppName: string | null } | null> {
    let entries: string[];
    try {
      entries = await readdir(SITES_ENABLED);
    } catch {
      return null; // directory unreadable — skip check
    }

    const domainRe   = new RegExp(`\\bserver_name\\s+${escapeRe(domain)}\\s*;`);
    const locationRe = new RegExp(`\\blocation\\s+${escapeRe(location)}\\s*\\{`);

    for (const entry of entries) {
      let content: string;
      try {
        content = await readFile(`${SITES_ENABLED}/${entry}`, 'utf8');
      } catch {
        continue;
      }
      if (!domainRe.test(content) || !locationRe.test(content)) continue;

      // This file claims domain+location — inspect ownership
      const markerMatch = content.match(new RegExp(`^${escapeRe(DEPLOYER_MARKER)}:\\s*(\\S+)`, 'm'));
      const ownerAppName = markerMatch?.[1] ?? null;

      if (ownerAppName === ownAppName) continue; // our own existing config

      return { file: entry, ownedByDeployer: ownerAppName !== null, ownerAppName };
    }
    return null;
  }

  generateBlock(opts: {
    appName: string;
    domain: string;
    upstreamPort: number;
    location?: string;
    ssl?: SslConfig | null;
  }): string {
    const upstream = `http://127.0.0.1:${opts.upstreamPort}`;
    const loc = opts.location ?? '/';
    const locationBlock = [
      `    location ${loc} {`,
      `        proxy_pass ${upstream};`,
      `        proxy_http_version 1.1;`,
      `        proxy_set_header Upgrade $http_upgrade;`,
      `        proxy_set_header Connection 'upgrade';`,
      `        proxy_set_header Host $host;`,
      `        proxy_set_header X-Real-IP $remote_addr;`,
      `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
      `        proxy_cache_bypass $http_upgrade;`,
      `    }`,
    ].join('\n');

    const marker = `${DEPLOYER_MARKER}: ${opts.appName}`;

    if (!opts.ssl) {
      return [
        marker,
        `server {`,
        `    listen 80;`,
        `    server_name ${opts.domain};`,
        ``,
        locationBlock,
        `}`,
        ``,
      ].join('\n');
    }

    const sslLines = [
      `    ssl_certificate ${opts.ssl.certPath};`,
      `    ssl_certificate_key ${opts.ssl.keyPath};`,
      ...(opts.ssl.optionsSslConf ? [`    include ${opts.ssl.optionsSslConf};`] : []),
      ...(opts.ssl.dhparamPath    ? [`    ssl_dhparam ${opts.ssl.dhparamPath};`] : []),
    ].join('\n');

    return [
      marker,
      `server {`,
      `    listen 80;`,
      `    server_name ${opts.domain};`,
      `    return 301 https://$host$request_uri;`,
      `}`,
      ``,
      `server {`,
      `    listen 443 ssl;`,
      `    server_name ${opts.domain};`,
      ``,
      sslLines,
      ``,
      locationBlock,
      `}`,
      ``,
    ].join('\n');
  }

  async write(appName: string, config: string): Promise<void> {
    this.logger.info({ appName }, 'writing nginx config');
    await execa('sudo', ['tee', this.configPath(appName)], { input: config });
    await this.enableSite(appName);
  }

  async restore(appName: string, previousConfig: string | null): Promise<void> {
    if (!previousConfig) {
      await this.remove(appName);
      return;
    }
    this.logger.info({ appName }, 'restoring nginx config');
    await execa('sudo', ['tee', this.configPath(appName)], { input: previousConfig });
    await this.reload();
  }

  async remove(appName: string): Promise<void> {
    try { await execa('sudo', ['rm', '-f', this.symlinkPath(appName)]); } catch { /* ok */ }
    try { await execa('sudo', ['rm', '-f', this.configPath(appName)]); } catch { /* ok */ }
    await this.reload();
  }

  async enableSite(appName: string): Promise<void> {
    try { await execa('sudo', ['rm', '-f', this.symlinkPath(appName)]); } catch { /* ok */ }
    await execa('sudo', ['ln', '-sf', this.configPath(appName), this.symlinkPath(appName)]);
    await this.reload();
  }

  async validate(): Promise<boolean> {
    try {
      await execa('sudo', ['nginx', '-t']);
      return true;
    } catch {
      return false;
    }
  }

  async reload(): Promise<void> {
    this.logger.info('reloading nginx');
    await execa('sudo', ['nginx', '-s', 'reload']);
  }
}
