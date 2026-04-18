#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { existsSync, writeFileSync, accessSync, constants, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  bgRed:  '\x1b[41m',
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

// ─── Arg parsing ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const domain  = getArg('--domain');
const port    = parseInt(getArg('--port') || '3000', 10);
const pm2Name = getArg('--pm2-name') || 'deployer';

// ─── Banner ──────────────────────────────────────────────────────────────────
console.log();
console.log(`${c.bold}${c.cyan}  Deployer Setup${c.reset}`);
console.log(`${c.dim}  ──────────────────────────────────────${c.reset}`);
if (domain) info(`Reverse proxy:  ${c.bold}${domain}${c.reset} → 127.0.0.1:${port}`);
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
  const v = run('git --version').stdout.trim();
  ok(v);
} else {
  fail('git not found — install git first');
  preflightOk = false;
}

// nginx
if (commandExists('nginx')) {
  const v = run('nginx -v 2>&1').stdout.trim() || run('nginx -v 2>&1').stderr.trim();
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

// nginx write permission (needed for vhost OR managed apps)
const nginxAvail = '/etc/nginx/sites-available';
try {
  accessSync(nginxAvail, constants.W_OK);
  ok(`Write access to ${nginxAvail}`);
} catch {
  fail(`No write access to ${nginxAvail} — run as root or configure sudoers`);
  preflightOk = false;
}

// PM2
if (commandExists('pm2')) {
  const v = run('pm2 -v').stdout.trim();
  ok(`PM2 ${v}`);
} else {
  warn('PM2 not found — will install globally (npm install -g pm2)');
}

if (!preflightOk) {
  die('Preflight failed — fix the issues above and re-run.');
}

// ─── .env check ──────────────────────────────────────────────────────────────
console.log();
const envPath = resolve(ROOT, '.env');
if (existsSync(envPath)) {
  const answer = await ask(
    `  ${c.yellow}⚠${c.reset}  .env already exists. Overwrite? ${c.dim}(y/N)${c.reset} `
  );
  if (answer.toLowerCase() !== 'y') {
    info('Keeping existing .env — skipping secret generation.');
    console.log();
  } else {
    generateEnv();
  }
} else {
  generateEnv();
}

function generateEnv() {
  const adminToken     = randomBytes(32).toString('hex'); // 64 hex chars
  const encryptionKey  = randomBytes(32).toString('hex'); // 64 hex chars

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
  ok(`.env written (mode 600)`);

  printAdminTokenWarning(adminToken);
}

function printAdminTokenWarning(token) {
  const width = 64;
  const border = '═'.repeat(width);
  const pad = (s) => {
    const space = width - s.length;
    const left = Math.floor(space / 2);
    const right = space - left;
    return ' '.repeat(left) + s + ' '.repeat(right);
  };

  console.log();
  console.log(`${c.bold}${c.bgRed}${c.white}╔${border}╗${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}║${pad('! WRITE THIS DOWN — YOUR ADMIN API KEY !')}║${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}╠${border}╣${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}║${pad(token)}║${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}╠${border}╣${c.reset}`);
  console.log(`${c.bold}${c.bgRed}${c.white}║${pad('This key is also saved in .env (keep that file safe)')}║${c.reset}`);
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

// ─── Build deployer ──────────────────────────────────────────────────────────
console.log(`${c.bold}  Building deployer${c.reset}`);

info('npm install…');
const install = run('npm install', { cwd: ROOT, stdio: 'inherit' });
if (install.status !== 0) die('npm install failed');

info('npm run build…');
const build = run('npm run build', { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) die('npm run build failed');

ok('Build complete');
console.log();

// ─── PM2 start ───────────────────────────────────────────────────────────────
console.log(`${c.bold}  Starting deployer via PM2${c.reset}`);

// Stop existing instance if any
run(`pm2 delete ${pm2Name} 2>/dev/null || true`);

const pm2Start = run(
  `pm2 start dist/index.js --name ${pm2Name} --env production`,
  { cwd: ROOT, stdio: 'inherit' }
);
if (pm2Start.status !== 0) die('PM2 start failed');

run(`pm2 save`, { stdio: 'inherit' });
ok(`Deployer running as PM2 process "${pm2Name}"`);
console.log();

// ─── Nginx vhost for deployer itself ─────────────────────────────────────────
if (domain) {
  console.log(`${c.bold}  Configuring nginx reverse proxy${c.reset}`);

  const configName = `deployer-${domain.replace(/[^a-z0-9.-]/gi, '-')}`;
  const configPath = `/etc/nginx/sites-available/${configName}`;
  const enabledPath = `/etc/nginx/sites-enabled/${configName}`;

  const nginxConf = [
    `server {`,
    `    listen 80;`,
    `    server_name ${domain};`,
    ``,
    `    location / {`,
    `        proxy_pass http://127.0.0.1:${port};`,
    `        proxy_http_version 1.1;`,
    `        proxy_set_header Upgrade $http_upgrade;`,
    `        proxy_set_header Connection 'upgrade';`,
    `        proxy_set_header Host $host;`,
    `        proxy_set_header X-Real-IP $remote_addr;`,
    `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `        proxy_set_header X-Forwarded-Proto $scheme;`,
    `    }`,
    `}`,
  ].join('\n');

  writeFileSync(configPath, nginxConf + '\n');
  ok(`Config written: ${configPath}`);

  // Symlink into sites-enabled
  run(`ln -sf ${configPath} ${enabledPath}`);
  ok(`Symlink created: ${enabledPath}`);

  // Validate and reload
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
  info(`Deployer API:  http://${domain}/`);
} else {
  info(`Deployer API:  http://localhost:${port}/`);
}
info(`Logs:          pm2 logs ${pm2Name}`);
info(`Status:        pm2 status`);
console.log();
