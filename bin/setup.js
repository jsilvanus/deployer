#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { existsSync, writeFileSync, chmodSync } from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const c = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  red:      '\x1b[31m',
  green:    '\x1b[32m',
  yellow:   '\x1b[33m',
  cyan:     '\x1b[36m',
  white:    '\x1b[37m',
  bgRed:    '\x1b[41m',
  bgYellow: '\x1b[43m',
};

const ok   = (msg) => console.log(`  ${c.green}✔${c.reset}  ${msg}`);
const fail = (msg) => console.log(`  ${c.red}✘${c.reset}  ${msg}`);
const warn = (msg) => console.log(`  ${c.yellow}⚠${c.reset}  ${msg}`);
const info = (msg) => console.log(`  ${c.cyan}›${c.reset}  ${msg}`);
const die  = (msg) => { console.error(`\n${c.bold}${c.red}Error:${c.reset} ${msg}\n`); process.exit(1); };

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
}

function commandExists(cmd) {
  return run(`command -v ${cmd}`).status === 0;
}

// ─── Root check ──────────────────────────────────────────────────────────────
// Must be before everything else — we need root to write sudoers and nginx configs.
if (process.getuid?.() !== 0) {
  const hint = process.argv.slice(2).join(' ');
  console.error(`
${c.bold}${c.bgRed}${c.white}  This script must be run with sudo  ${c.reset}

  ${c.bold}sudo node bin/setup.js${hint ? ' ' + hint : ''}${c.reset}

  Root is required to:
    ${c.dim}•${c.reset} Write /etc/sudoers.d/deployer-nginx (nginx management rights)
    ${c.dim}•${c.reset} Write nginx config to /etc/nginx/sites-available/
    ${c.dim}•${c.reset} Reload nginx
`);
  process.exit(1);
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const domain      = getArg('--domain');
const port        = parseInt(getArg('--port') || '3000', 10);
const pm2Name     = getArg('--pm2-name') || 'deployer';
const location    = getArg('--location') || '/';
const deployUser  = getArg('--user') || process.env.SUDO_USER || process.env.USER;

if (!deployUser || deployUser === 'root') {
  die(
    'Could not determine the deploy user (got: ' + (deployUser || 'none') + ').\n' +
    '  Pass --user <username> explicitly, e.g.:\n\n' +
    '    sudo node bin/setup.js --user myuser'
  );
}

// ─── Banner ──────────────────────────────────────────────────────────────────
console.log();
console.log(`${c.bold}${c.cyan}  Deployer Setup${c.reset}`);
console.log(`${c.dim}  ──────────────────────────────────────${c.reset}`);
info(`Deploy user:    ${c.bold}${deployUser}${c.reset}`);
info(`Port:           ${c.bold}${port}${c.reset}`);
info(`PM2 name:       ${c.bold}${pm2Name}${c.reset}`);
if (domain) info(`Reverse proxy:  ${c.bold}${domain}${c.reset} → 127.0.0.1:${port} (location: ${location})`);
else        info(`No --domain given — skipping nginx vhost for deployer`);
console.log();

// ─── Preflight checks ────────────────────────────────────────────────────────
console.log(`${c.bold}  Preflight checks${c.reset}`);

let preflightOk = true;

// Node version
const nodeVer = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVer >= 20) {
  ok(`Node.js ${process.versions.node}`);
} else {
  fail(`Node.js ${process.versions.node} — requires ≥ 20`);
  preflightOk = false;
}

// git
if (commandExists('git')) {
  ok(run('git --version').stdout.trim());
} else {
  fail('git not found — install git first');
  preflightOk = false;
}

// nginx
if (commandExists('nginx')) {
  const v = run('nginx -v 2>&1').stderr.trim() || run('nginx -v 2>&1').stdout.trim();
  ok(v || 'nginx found');

  const nginxTest = run('nginx -t 2>&1');
  if (nginxTest.status === 0) {
    ok('nginx config valid (nginx -t)');
  } else {
    fail(`nginx config invalid:\n${nginxTest.stdout}${nginxTest.stderr}`);
    preflightOk = false;
  }
} else {
  fail('nginx not found — install nginx first');
  preflightOk = false;
}

// visudo (needed to validate sudoers file)
if (commandExists('visudo')) {
  ok('visudo found');
} else {
  fail('visudo not found — install sudo package');
  preflightOk = false;
}

// PM2
if (commandExists('pm2')) {
  ok(`PM2 ${run('pm2 -v').stdout.trim()}`);
} else {
  warn('PM2 not found — will install globally');
}

// Verify deploy user exists on the system
const userCheck = run(`id ${deployUser} 2>&1`);
if (userCheck.status === 0) {
  ok(`User "${deployUser}" exists`);
} else {
  fail(`User "${deployUser}" not found on this system`);
  preflightOk = false;
}

if (!preflightOk) {
  die('Preflight failed — fix the issues above and re-run.');
}

// ─── .env ────────────────────────────────────────────────────────────────────
console.log();
const envPath = resolve(ROOT, '.env');
let skipEnv = false;

if (existsSync(envPath)) {
  const answer = await ask(
    `  ${c.yellow}⚠${c.reset}  .env already exists. Overwrite? ${c.dim}(y/N)${c.reset} `
  );
  if (answer.toLowerCase() !== 'y') {
    info('Keeping existing .env — skipping secret generation.');
    skipEnv = true;
    console.log();
  }
}

if (!skipEnv) {
  const adminToken    = randomBytes(32).toString('hex');
  const encryptionKey = randomBytes(32).toString('hex');

  const env = [
    `DEPLOYER_PORT=${port}`,
    ``,
    `# Required: at least 16 characters`,
    `DEPLOYER_ADMIN_TOKEN=${adminToken}`,
    ``,
    `# Required: exactly 64 hex chars (32 bytes) — used for AES-256-GCM .env encryption`,
    `DEPLOYER_ENV_ENCRYPTION_KEY=${encryptionKey}`,
    ``,
    `# Comma-separated list of allowed deploy path prefixes (path traversal guard)`,
    `DEPLOYER_ALLOWED_DEPLOY_PATHS=/srv/apps`,
    ``,
    `# SQLite database path`,
    `DEPLOYER_DB_PATH=./deployer.db`,
    ``,
    `# Log level: trace | debug | info | warn | error`,
    `LOG_LEVEL=info`,
    ``,
    `# Set to 'development' for pretty log output`,
    `NODE_ENV=production`,
  ].join('\n');

  writeFileSync(envPath, env + '\n', { mode: 0o600 });
  ok('.env written (mode 600)');

  // ── Big admin token warning ──
  const width  = 64;
  const border = '═'.repeat(width);
  const pad    = (s) => {
    const space = width - s.length;
    const left  = Math.floor(space / 2);
    return ' '.repeat(left) + s + ' '.repeat(space - left);
  };

  console.log();
  console.log(`${c.bold}${c.bgRed}${c.white}╔${border}╗${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}║${pad('! WRITE THIS DOWN — YOUR ADMIN API KEY !')}║${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}╠${border}╣${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}║${pad(adminToken)}║${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}╠${border}╣${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}║${pad('Also saved in .env — keep that file safe (mode 600)')}║${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}╚${border}╝${c.reset}`);
  console.log();
}

// ─── Install PM2 if missing ──────────────────────────────────────────────────
if (!commandExists('pm2')) {
  console.log(`${c.bold}  Installing PM2${c.reset}`);
  const r = run('npm install -g pm2', { stdio: 'inherit' });
  if (r.status !== 0) die('PM2 install failed — run: npm install -g pm2');
  ok('PM2 installed');
  console.log();
}

// ─── Build ───────────────────────────────────────────────────────────────────
console.log(`${c.bold}  Building deployer${c.reset}`);

info('npm install…');
if (run('npm install', { cwd: ROOT, stdio: 'inherit' }).status !== 0) die('npm install failed');

info('npm run build…');
if (run('npm run build', { cwd: ROOT, stdio: 'inherit' }).status !== 0) die('npm run build failed');

ok('Build complete');
console.log();

// ─── Sudoers ─────────────────────────────────────────────────────────────────
// Grant the deploy user passwordless sudo for the specific nginx commands the
// deployer runtime needs. Nothing broader than these exact operations.
console.log(`${c.bold}  Configuring sudoers for nginx management${c.reset}`);

const nginxBin = run('which nginx').stdout.trim();
const teeBin   = run('which tee').stdout.trim();
const lnBin    = run('which ln').stdout.trim();
const rmBin    = run('which rm').stdout.trim();

if (!nginxBin || !teeBin || !lnBin || !rmBin) {
  die('Could not locate required binaries (nginx, tee, ln, rm).');
}

const sudoersPath = '/etc/sudoers.d/deployer-nginx';
const sudoersContent = [
  `# Deployer nginx management — written by deployer-setup`,
  `# Grants "${deployUser}" passwordless sudo for nginx config operations only.`,
  `Cmnd_Alias DEPLOYER_NGINX = \\`,
  `    ${nginxBin} -t, \\`,
  `    ${nginxBin} -s reload, \\`,
  `    ${teeBin} /etc/nginx/sites-available/*, \\`,
  `    ${lnBin} -sf /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*, \\`,
  `    ${rmBin} -f /etc/nginx/sites-enabled/*, \\`,
  `    ${rmBin} -f /etc/nginx/sites-available/*`,
  `${deployUser} ALL=(ALL) NOPASSWD: DEPLOYER_NGINX`,
].join('\n');

// Write to a temp file first, validate with visudo, then move into place
const tmpSudoers = `/tmp/deployer-sudoers-${process.pid}`;
writeFileSync(tmpSudoers, sudoersContent + '\n', { mode: 0o440 });

const visudoCheck = run(`visudo -c -f ${tmpSudoers} 2>&1`);
if (visudoCheck.status !== 0) {
  run(`rm -f ${tmpSudoers}`);
  die(`Generated sudoers file failed validation:\n${visudoCheck.stdout}${visudoCheck.stderr}`);
}

run(`mv ${tmpSudoers} ${sudoersPath}`);
chmodSync(sudoersPath, 0o440);
ok(`Sudoers written: ${sudoersPath}`);
info(`Grants "${deployUser}" NOPASSWD for: nginx -t, nginx -s reload, tee/ln/rm in /etc/nginx/`);
console.log();

// ─── PM2 start (as deploy user) ──────────────────────────────────────────────
console.log(`${c.bold}  Starting deployer via PM2${c.reset}`);

// Run PM2 as the deploy user, not root
const pm2Cmd = (cmd) => run(`su -s /bin/sh ${deployUser} -c "pm2 ${cmd}"`, { cwd: ROOT, stdio: 'inherit' });

pm2Cmd(`delete ${pm2Name} 2>/dev/null || true`);

if (pm2Cmd(`start dist/index.js --name ${pm2Name} --env production`).status !== 0) {
  die('PM2 start failed');
}
pm2Cmd('save');

ok(`Deployer running as PM2 process "${pm2Name}" (user: ${deployUser})`);
console.log();

// ─── Nginx vhost for deployer itself ─────────────────────────────────────────
let ssl = null; // hoisted so the Done section can read it

if (domain) {
  console.log(`${c.bold}  Configuring nginx reverse proxy${c.reset}`);

  // ── SSL detection ──
  const leCert    = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  const leKey     = `/etc/letsencrypt/live/${domain}/privkey.pem`;
  const leOptions = `/etc/letsencrypt/options-ssl-nginx.conf`;
  const leDhparam = `/etc/letsencrypt/ssl-dhparams.pem`;

  if (existsSync(leCert) && existsSync(leKey)) {
    ssl = {
      certPath:      leCert,
      keyPath:       leKey,
      optionsSslConf: existsSync(leOptions) ? leOptions : null,
      dhparamPath:    existsSync(leDhparam) ? leDhparam : null,
    };
    ok(`Let's Encrypt certificate found — using HTTPS config`);
  } else if (commandExists('certbot')) {
    warn(`No certificate found for ${domain} — certbot is installed`);
    const obtain = await ask(
      `  ${c.cyan}›${c.reset}  Obtain a certificate now? (certbot --nginx -d ${domain}) ${c.dim}(y/N)${c.reset} `
    );
    if (obtain.toLowerCase() === 'y') {
      info('Running certbot…');
      const certbotResult = run(`certbot --nginx -d ${domain}`, { stdio: 'inherit' });
      if (certbotResult.status !== 0) {
        warn('certbot failed — falling back to plain HTTP. You can run certbot manually later.');
      } else {
        ok(`Certificate obtained`);
        ssl = {
          certPath:      leCert,
          keyPath:       leKey,
          optionsSslConf: existsSync(leOptions) ? leOptions : null,
          dhparamPath:    existsSync(leDhparam)  ? leDhparam : null,
        };
      }
    } else {
      info('Skipping — using plain HTTP. Run certbot later to enable SSL.');
    }
  } else {
    info('certbot not installed — using plain HTTP config');
    info('Install certbot and re-run setup (or run certbot manually) to enable SSL.');
  }

  // ── Generate nginx config ──
  const locationBlock = [
    `    location ${location} {`,
    `        proxy_pass http://127.0.0.1:${port};`,
    `        proxy_http_version 1.1;`,
    `        proxy_set_header Upgrade $http_upgrade;`,
    `        proxy_set_header Connection 'upgrade';`,
    `        proxy_set_header Host $host;`,
    `        proxy_set_header X-Real-IP $remote_addr;`,
    `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `        proxy_set_header X-Forwarded-Proto $scheme;`,
    `        proxy_cache_bypass $http_upgrade;`,
    `    }`,
  ].join('\n');

  let nginxConf;
  if (ssl) {
    const sslLines = [
      `    ssl_certificate ${ssl.certPath};`,
      `    ssl_certificate_key ${ssl.keyPath};`,
      ...(ssl.optionsSslConf ? [`    include ${ssl.optionsSslConf};`] : []),
      ...(ssl.dhparamPath    ? [`    ssl_dhparam ${ssl.dhparamPath};`] : []),
    ].join('\n');

    nginxConf = [
      `server {`,
      `    listen 80;`,
      `    server_name ${domain};`,
      `    return 301 https://$host$request_uri;`,
      `}`,
      ``,
      `server {`,
      `    listen 443 ssl;`,
      `    server_name ${domain};`,
      ``,
      sslLines,
      ``,
      locationBlock,
      `}`,
      ``,
    ].join('\n');
  } else {
    nginxConf = [
      `server {`,
      `    listen 80;`,
      `    server_name ${domain};`,
      ``,
      locationBlock,
      `}`,
      ``,
    ].join('\n');
  }

  const configName  = `deployer-${domain.replace(/[^a-z0-9.-]/gi, '-')}`;
  const configPath  = `/etc/nginx/sites-available/${configName}`;
  const enabledPath = `/etc/nginx/sites-enabled/${configName}`;

  // Running as root during setup — write directly
  writeFileSync(configPath, nginxConf);
  ok(`Config written: ${configPath}`);

  run(`ln -sf ${configPath} ${enabledPath}`);
  ok(`Symlink created: ${enabledPath}`);

  const validate = run('nginx -t 2>&1');
  if (validate.status !== 0) {
    die(`nginx config invalid after writing vhost:\n${validate.stdout}${validate.stderr}`);
  }

  run('nginx -s reload');
  ok('nginx reloaded');
  console.log();
}

// ─── Done ────────────────────────────────────────────────────────────────────
console.log(`${c.bold}${c.green}  ✔ Setup complete!${c.reset}`);
console.log();
if (domain) {
  info(`Deployer API:   ${ssl ? 'https' : 'http'}://${domain}/`);
} else {
  info(`Deployer API:   http://localhost:${port}/`);
}
info(`Logs:           pm2 logs ${pm2Name}`);
info(`Status:         pm2 status`);
info(`Sudoers:        ${sudoersPath}`);
console.log();
