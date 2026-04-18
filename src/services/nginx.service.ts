import { access } from 'node:fs/promises';
import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED   = '/etc/nginx/sites-enabled';

const LE_BASE         = '/etc/letsencrypt/live';
const LE_OPTIONS_CONF = '/etc/letsencrypt/options-ssl-nginx.conf';
const LE_DHPARAM      = '/etc/letsencrypt/ssl-dhparams.pem';

const DEPLOYER_MARKER = '# deployer-managed';

export type SslConfig = {
  certPath: string;
  keyPath: string;
  optionsSslConf: string | null;
  dhparamPath: string | null;
};

export type NginxConflict = {
  file: string;
  ownedByDeployer: boolean;
  ownerAppName: string | null;
  // true  → existing "location /" catch-all on same domain; warn only, don't hard-fail
  // false → exact location path match; hard-fail
  isCatchAll: boolean;
};

// ─── nginx -T parser ─────────────────────────────────────────────────────────

type LocationEntry = { modifier: string; path: string };
type ParsedBlock   = {
  file: string;
  ownerAppName: string | null;
  serverNames: string[];
  locations: LocationEntry[];
};

// Parses the output of `nginx -T` into a flat list of server blocks.
// Each block carries the file it came from and the deployer app name if
// the file was written by us (via the "# deployer-managed: <name>" marker).
function parseNginxDump(output: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = output.split('\n');

  let currentFile       = '';
  let currentFileMarker: string | null = null;
  let depth             = 0;
  let inServer          = false;
  let serverEntryDepth  = 0;
  let current: ParsedBlock | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ── New configuration file section ──────────────────────────────────────
    // nginx -T emits "# configuration file /path/to/file:" before each file's content.
    const fileMatch = trimmed.match(/^#\s*configuration file\s+(.+?)\s*:$/);
    if (fileMatch) {
      if (current) { blocks.push(current); current = null; inServer = false; }
      currentFile       = fileMatch[1]!;
      currentFileMarker = null;
      depth             = 0;
      continue;
    }

    // ── Deployer ownership marker ────────────────────────────────────────────
    // Written as the first line of every deployer-generated config file.
    const markerMatch = trimmed.match(/^#\s*deployer-managed:\s*(\S+)/);
    if (markerMatch && !inServer) {
      currentFileMarker = markerMatch[1]!;
      continue;
    }

    // ── Brace counting (ignores strings/comments — sufficient for nginx configs)
    let opens = 0, closes = 0;
    for (const ch of line) {
      if (ch === '{') opens++;
      else if (ch === '}') closes++;
    }

    if (!inServer) {
      if (trimmed.match(/^server\s*\{/)) {
        inServer         = true;
        serverEntryDepth = depth;
        current = {
          file:         currentFile,
          ownerAppName: currentFileMarker,
          serverNames:  [],
          locations:    [],
        };
      }
      depth += opens - closes;
    } else if (current) {
      // relDepth === 1 means we are a direct child of the server { } block
      const relDepth = depth - serverEntryDepth;

      if (relDepth === 1) {
        if (trimmed.startsWith('server_name ')) {
          const names = trimmed
            .slice('server_name '.length)
            .replace(/;$/, '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          current.serverNames.push(...names);
        }

        // Capture location directive with optional modifier
        // Handles: location /p {   location = /p {   location ~ re {   location ^~ /p {
        const locMatch = trimmed.match(/^location\s+(=\s+|~\*?\s+|\^~\s+)?(\S+)/);
        if (locMatch) {
          const modifier = (locMatch[1] ?? '').trim();
          const path     = locMatch[2]!.replace(/\{$/, '').trim();
          current.locations.push({ modifier, path });
        }
      }

      depth += opens - closes;

      if (depth <= serverEntryDepth) {
        blocks.push(current);
        current  = null;
        inServer = false;
        // Keep currentFileMarker — next server block in the same file (e.g. SSL
        // redirect block) should still be attributed to the same app.
      }
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

// ─── NginxService ─────────────────────────────────────────────────────────────

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
      const { stdout } = await execa('cat', [this.configPath(appName)]);
      return stdout;
    } catch {
      return null;
    }
  }

  // Returns SSL paths if a Let's Encrypt certificate exists for the domain.
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

  // Runs `sudo nginx -T` to get the full effective nginx configuration and checks
  // whether any existing server block already claims domain+location.
  //
  // Returns null if the path is clear.
  // Returns a conflict descriptor otherwise:
  //   isCatchAll=false → exact location match → hard fail
  //   isCatchAll=true  → existing "location /" on same domain → warn only
  async findExternalConflict(
    domain: string,
    location: string,
    ownAppName: string,
  ): Promise<NginxConflict | null> {
    let stdout: string;
    try {
      ({ stdout } = await execa('sudo', ['nginx', '-T'], { reject: false }));
    } catch {
      this.logger.warn('preflight: could not run nginx -T — skipping external config check');
      return null;
    }

    if (!stdout.includes('# configuration file')) {
      this.logger.warn('preflight: nginx -T produced no config output — skipping check');
      return null;
    }

    const blocks = parseNginxDump(stdout);

    for (const block of blocks) {
      if (block.ownerAppName === ownAppName) continue;       // our own existing config
      if (!block.serverNames.includes(domain)) continue;    // different domain

      for (const loc of block.locations) {
        // Regex locations (~ or ~*) — skip, too complex to evaluate for overlap
        if (loc.modifier === '~' || loc.modifier === '~*') continue;

        // Exact path match on any modifier → hard conflict
        if (loc.path === location) {
          return {
            file:            block.file,
            ownedByDeployer: block.ownerAppName !== null,
            ownerAppName:    block.ownerAppName,
            isCatchAll:      false,
          };
        }

        // Existing catch-all "/" on the same domain → warn only
        if (loc.path === '/' && location !== '/') {
          return {
            file:            block.file,
            ownedByDeployer: block.ownerAppName !== null,
            ownerAppName:    block.ownerAppName,
            isCatchAll:      true,
          };
        }
      }
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
    const loc      = opts.location ?? '/';
    const marker   = `${DEPLOYER_MARKER}: ${opts.appName}`;

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

    if (!opts.ssl) {
      return [marker, `server {`, `    listen 80;`, `    server_name ${opts.domain};`, ``, locationBlock, `}`, ``].join('\n');
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
