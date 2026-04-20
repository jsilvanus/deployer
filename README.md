# @jsilvanus/deployer

A self-hosted deployment orchestrator with a REST API and MCP server. Manages deploying, updating, and **reversibly rolling back** Node.js, Python, and Docker applications on a Linux server.

Every step snapshots the state it changes before running. On failure — or on an explicit rollback — every completed step is undone in reverse: git is reset, `.env` files are restored from encrypted backups, migrations are reversed, and nginx configs are rewritten.

---

## Quick start (npx)

```bash
# Create a minimal .env in your working directory
cat > .env <<'EOF'
DEPLOYER_ADMIN_TOKEN=replace-with-32-chars-or-more
DEPLOYER_ENV_ENCRYPTION_KEY=replace-with-64-hex-chars
EOF

npx @jsilvanus/deployer
# Server listens on http://localhost:3000
```

Generate a secure encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Installation options

### Option A — Bare metal (Ubuntu/Debian, PM2 + nginx)

Clone, install dependencies, and run the interactive setup wizard:

```bash
git clone https://github.com/jsilvanus/deployer.git
cd deployer
sudo node bin/setup.js --user $USER --domain deployer.example.com --port 3000
```

The wizard:
1. Checks prerequisites (Node ≥ 20, git, nginx, PM2)
2. Generates `.env` with random secrets and prints the admin token
3. Builds the TypeScript project (`npm run build`)
4. Writes a minimal sudoers rule so the deployer can manage nginx configs without full root
5. Starts the server as a PM2 process
6. Configures an nginx reverse proxy for the domain (with optional Let's Encrypt SSL)

**Full flag reference:**

| Flag | Default | Description |
|---|---|---|
| `--user <name>` | `$SUDO_USER` | OS user to run PM2 under |
| `--domain <host>` | — | Domain for nginx reverse proxy |
| `--port <n>` | `3000` | HTTP port |
| `--location <path>` | `/` | nginx location block |
| `--pm2-name <name>` | `deployer` | PM2 process name |
| `--traefik` | — | Set up Traefik after startup |
| `--traefik-mode <mode>` | `auto` | `standalone`, `behind-nginx`, or `auto` |
| `--traefik-port <n>` | `8080` | Traefik HTTP port |
| `--acme-email <email>` | — | Let's Encrypt email (standalone mode) |
| `--self-register` | — | Register the deployer as a managed app after startup |

**Example — full bare-metal setup with Traefik and self-registration:**
```bash
sudo node bin/setup.js \
  --user deploy \
  --domain deployer.example.com \
  --traefik \
  --traefik-mode standalone \
  --acme-email admin@example.com \
  --self-register
```

### Option B — Docker

```yaml
# docker-compose.yml
services:
  deployer:
    image: ghcr.io/jsilvanus/deployer:latest
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /srv/apps:/srv/apps
      - deployer-data:/data
    environment:
      DEPLOYER_ADMIN_TOKEN: "your-admin-token"
      DEPLOYER_ENV_ENCRYPTION_KEY: "64-hex-chars"
      DEPLOYER_DB_PATH: /data/deployer.db
      DEPLOYER_ALLOWED_DEPLOY_PATHS: /srv/apps

volumes:
  deployer-data:
```

```bash
docker compose up -d
```

When running in Docker, `node` and `python` app types are not available (PM2 is not in the image). Use `docker` or `compose` app types instead.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEPLOYER_ADMIN_TOKEN` | Yes | — | Bearer token for admin access. Min 16 chars. |
| `DEPLOYER_ENV_ENCRYPTION_KEY` | Yes | — | 64 hex chars (32 bytes). AES-256-GCM key for `.env` backups. **Back this up — loss makes rollbacks unreadable.** |
| `DEPLOYER_PORT` | No | `3000` | HTTP listen port |
| `DEPLOYER_ALLOWED_DEPLOY_PATHS` | No | `/srv/apps` | Comma-separated list of allowed `deployPath` prefixes (path traversal guard) |
| `DEPLOYER_DB_PATH` | No | `./deployer.db` | SQLite database file path |
| `LOG_LEVEL` | No | `info` | `trace` \| `debug` \| `info` \| `warn` \| `error` |
| `NODE_ENV` | No | `production` | Set to `development` for pretty-printed logs |

---

## Authentication

**Admin token** — set via `DEPLOYER_ADMIN_TOKEN`. Full access to all routes and all apps.

**Per-app API keys** — generated when you register an app (`POST /apps`). Returned **once** — store it. A per-app key authorises deploy/update/rollback/status/logs/metrics for that one app only. Useful for scoping CI pipelines or AI agents.

All routes (except `GET /health`) require `Authorization: Bearer <token>`.

---

## App types

| Type | Runtime | Bare metal | Docker mode |
|---|---|---|---|
| `node` | PM2 | ✔ | ✗ |
| `python` | PM2 + interpreter | ✔ | ✗ |
| `docker` | Docker Compose (from git repo) | ✔ | ✔ |
| `compose` | Docker Compose (from inline YAML) | ✔ | ✔ |

### `node` — bare-metal Node.js via PM2

Entry point is read from `package.json` `main`, falling back to `index.js`.

Deploy plan: `preflight → git clone → env setup → database create → migrations → pm2 start → nginx`

Update plan: `preflight → git pull → env setup → migrations → pm2 restart → nginx`

### `python` — bare-metal Python via PM2

Entry point is detected by checking for `main.py`, `app.py`, `run.py`, `manage.py`, `wsgi.py` in order. Interpreter is detected from `.venv/bin/python`, `venv/bin/python`, falling back to `python3`.

Deploy/update plans are identical to `node`.

### `docker` — Docker Compose from a git repository

The repo must contain a `docker-compose.yml`. At deploy time the deployer optionally generates:
- `docker-compose.traefik.yml` — Traefik label override (when `domain` + `primaryService` are set)
- `docker-compose.internal.yml` — joins all services to `deployer-internal` bridge network (when `internalNetwork: true`)

Deploy plan: `preflight → git clone → env setup → database create → migrations → docker compose up → nginx`

### `compose` — Docker Compose from inline YAML

Store the `docker-compose.yml` content directly on the app record via `composeContent`. The deployer writes it to `deployPath` at deploy time. Traefik and internal-network overrides work the same as `docker` type.

Deploy plan: `preflight → compose write → docker compose up`

---

## Registering an app
Refer to the included OpenAPI specification for full API details and example requests. The canonical spec is [openapi.yaml](openapi.yaml#L1) in the repository root.

**Save the `apiKey` from the response — it is shown only once.**

### App fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique. Lowercase, hyphens OK. Used as PM2 process name and Docker project name. |
| `type` | Yes | `node` \| `python` \| `docker` \| `compose` |
| `repoUrl` | node/python/docker | Git clone URL (SSH or HTTPS) |
| `branch` | No | Branch to deploy. Default: `main` |
| `deployPath` | Yes | Absolute path on server |
| `composeContent` | compose | Full `docker-compose.yml` content (stored encrypted) |
| `primaryService` | No | Service name in compose file to expose via Traefik |
| `internalNetwork` | No | Join all services to `deployer-internal` Docker bridge. Default: `true` for docker/compose, `false` for node/python |
| `domain` | No | Domain for nginx or Traefik routing |
| `port` | No | App port for nginx `proxy_pass` |
| `nginxEnabled` | No | Manage nginx reverse proxy. Default: `false` |
| `nginxLocation` | No | nginx location block path. Default: `/` |
| `dbEnabled` | No | Provision a Postgres database on deploy. Default: `false` |
| `dbType` | No | `postgres` \| `sqlite`. Default: `postgres` |
| `dbName` | No | Database name. Default: app `name` |
| `pgHost` | No | Postgres host. Default: `localhost` |
| `pgPort` | No | Postgres port. Default: `5432` |
| `pgAdminUser` | No | Postgres superuser for provisioning. Default: `postgres` |
| `pgAdminPassword` | No | Postgres superuser password (stored encrypted) |

---

## REST API

All routes except `GET /health` require `Authorization: Bearer <token>`. Deployments return `202 Accepted` with a `deploymentId`; poll `GET /deployments/:id` for status.

### Health
```
GET  /health
```

### Apps
```
GET    /apps                          List all apps (admin only)
POST   /apps                          Register app → returns { app, apiKey }
GET    /apps/:appId                   Get app
PATCH  /apps/:appId                   Update app config
DELETE /apps/:appId                   Delete app record (does not stop processes)
GET    /apps/:appId/deployments       Deployment history
```

### Deployments
```
POST   /apps/:appId/deploy            Initial deploy → 202 + deploymentId
POST   /apps/:appId/update            Update (pull + restart) → 202
POST   /apps/:appId/rollback          Roll back last successful deployment → 202
POST   /apps/:appId/migrations/run    Body: { direction: "up"|"down" }

GET    /deployments/:id               Deployment details
GET    /deployments/:id/snapshots     Per-step snapshots (shows what rollback reverts)
POST   /deployments/:id/rollback      Roll back a specific deployment → 202
```

### Status
```
GET  /apps/:appId/status

# node/python response:
{ appId, appName, type, status, pid, memory, cpu, uptime }

# docker/compose response:
{ appId, appName, type, status, services: [{ name, state, cpu, memory, memoryPercent, pids }] }
```

### Logs
```
GET  /apps/:appId/logs?lines=100&stderr=true
# Returns: { appId, appName, stdout, stderr }
# node/python: reads ~/.pm2/logs/<name>-out/err.log
# docker/compose: docker compose logs --tail

GET  /apps/:appId/logs/stream
# Server-Sent Events live tail (text/event-stream)
# Each event: data: "<line>\n\n"
```

### Metrics
```
GET  /apps/:appId/metrics?from=<ISO>&to=<ISO>
# Returns: { appId, appName, from, to, points: [{ timestamp, status, cpu, memoryMb }] }
# Default window: last hour. Retention: 7 days.

GET  /metrics
# Prometheus exposition format (admin only). Gauges + labelled state:
#   deployer_app_status{app,type}        1=running, 0=other
#   deployer_app_state{app,type,state}   labelled enumerated state (state="running"|"updating"|...)
#   deployer_app_updating{app,type}      1=updating, 0=not updating (convenience gauge)
#   deployer_app_cpu_percent{app,type}
#   deployer_app_memory_mb{app,type}
```

### Per-app env vars
```
GET    /apps/:appId/env               List stored key names (values hidden)
PUT    /apps/:appId/env               Body: { KEY: "value", ... }  — set/overwrite multiple
DELETE /apps/:appId/env/:key          Delete one key
```

### Setup
```
POST  /setup/traefik
# Body: { mode?: "auto"|"standalone"|"behind-nginx", acmeEmail?: string, port?: number }
# Installs Traefik as a compose app. auto-detects standalone vs behind-nginx from nginx presence.

POST  /setup/self-register
# Body: { name?: string, repoUrl?: string, branch?: string, deployPath?: string }
# Registers the deployer itself as a managed node app (auto-detects repoUrl from git remote).

POST  /setup/self-update
# Body: { name?: string }
# Runs: git pull → npm install → npm build → db migrate → pm2 restart
```

### Deploy request body
```jsonc
{
  "triggeredBy": "api",      // "api" | "mcp"
  "envVars": {               // written/merged into .env at deployPath
    "NODE_ENV": "production",
    "PORT": "4000"
  },
  "allowDbDrop": false       // set true to allow DROP DATABASE on db rollback
}
```

---

## Traefik routing

For Docker apps that need HTTP routing, the deployer integrates with Traefik:

```bash
# 1. Install Traefik (auto-detects mode from nginx presence)
POST /setup/traefik
{ "mode": "auto", "acmeEmail": "admin@example.com" }

# 2. Register your docker app with domain + primaryService
POST /apps
{
  "name": "my-app",
  "type": "docker",
  "repoUrl": "git@github.com:you/my-app.git",
  "deployPath": "/srv/apps/my-app",
  "domain": "my-app.example.com",
  "primaryService": "web",
  "port": 3000
}
```

At deploy time the deployer writes `docker-compose.traefik.yml` alongside the app's own `docker-compose.yml` and runs `docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d`. The repo's compose file is never modified.

**Modes:**
- `standalone` — Traefik owns ports 80/443 with automatic Let's Encrypt TLS
- `behind-nginx` — Traefik listens on an internal port; nginx proxies to it

### Internal Docker networking

Apps with `internalNetwork: true` (default for docker/compose) are joined to the `deployer-internal` bridge network at deploy time. This lets containers reach each other by service name without exposing ports to the host. The network is created lazily on first deploy.

---

## Self-register and self-update

Register the deployer to manage its own updates:

```bash
# Register (auto-detects git remote)
POST /setup/self-register

# Update (git pull → npm install → npm build → migrate → pm2 restart)
POST /setup/self-update
```

The deployer restarts itself via PM2 after a successful build. Track progress by polling the returned `deploymentId`.

---

## Metrics and Prometheus

The deployer samples all apps every 30 seconds and stores CPU, memory, and status in SQLite (7-day retention).

```bash
# Time-series query (last hour by default)
GET /apps/:appId/metrics?from=2024-01-01T00:00:00Z&to=2024-01-01T01:00:00Z

# Prometheus scrape endpoint (add to prometheus.yml)
GET /metrics   # Authorization: Bearer <admin-token>
```

Prometheus config example:
```yaml
scrape_configs:
  - job_name: deployer
    bearer_token: "your-admin-token"
    static_configs:
      - targets: ["localhost:3000"]
    metrics_path: /metrics
```

---

## MCP (AI agent integration)

The MCP server runs on the same port at `/mcp` (Streamable HTTP transport). Point Claude Desktop, Claude Code, or any MCP-compatible client at:

```
http://localhost:3000/mcp
```

With the same admin token as the REST API.

### Available MCP tools

| Tool | Description |
|---|---|
| `list_apps` | List all registered apps; optional `type` filter |
| `register_app` | Register a new app (all 4 types supported) |
| `update_app_config` | Patch app settings (branch, domain, nginx, compose content, etc.) |
| `delete_app` | Delete app record |
| `get_app_status` | Live PM2 or Docker Compose status with CPU/memory |
| `get_app_logs` | Tail recent log output (PM2 files or docker compose logs) |
| `get_app_metrics` | Query historical CPU/memory metrics |
| `deploy_app` | Initial deployment |
| `update_app` | Pull latest and restart |
| `rollback_app` | Roll back to last successful or a specific deployment |
| `get_deployment` | Poll deployment status by ID |
| `list_deployments` | Deployment history, optionally filtered by app |
| `get_deployment_snapshots` | Inspect what a rollback would revert |
| `get_app_env_keys` | List stored env var key names |
| `set_app_env` | Store encrypted env vars |
| `delete_app_env` | Delete a stored env var |
| `run_migrations` | Run migrations up or down |
| `setup_traefik` | Install and configure Traefik |
| `self_register` | Register the deployer as a managed app |
| `self_update` | Update the deployer itself |

---

## Reversibility

Every step captures a snapshot before it runs. On failure or explicit rollback, steps are undone in reverse order.

| Step | Snapshot | Rollback action |
|---|---|---|
| `git-clone` | repo path | `rm -rf` the directory |
| `git-pull` | commit hash before pull | `git reset --hard <hash>` |
| `env-setup` | `.env` contents (AES-256-GCM encrypted) | restore previous file |
| `database-create` | whether DB was newly created | `DROP DATABASE` + `DROP USER` (requires `allowDbDrop: true`) |
| `migration-up` | list of files applied | run `.down.sql` files in reverse |
| `pm2-start` | process name | `pm2 delete <name>` |
| `pm2-restart` | commit hash + process state | `git reset --hard` + `pm2 restart` |
| `docker-compose-up` | compose path + service names | `docker compose down` |
| `nginx-configure` | previous config text | write back + `nginx -s reload` |
| `npm-build` | — | not reversible (dist/ is overwritten) |
| `compose-write` | previous file contents | restore previous `docker-compose.yml` |

---

## Migration runners

The deployer auto-detects the migration tool used by a deployed app:

| Detection | Runner | Up | Down |
|---|---|---|---|
| `drizzle.config.ts` or `.js` | Drizzle Kit | `npx drizzle-kit migrate` | warning (no built-in rollback) |
| `prisma/schema.prisma` | Prisma | `npx prisma migrate deploy` | warning (no native rollback) |
| `migrations/` directory | Raw SQL | runs `*.sql` in order | runs matching `*.down.sql` in reverse |

---

## Data storage

SQLite database (default `./deployer.db`) with six tables:

| Table | Contents |
|---|---|
| `apps` | App config, hashed API keys |
| `deployments` | History with status, git hashes, error messages |
| `deployment_snapshots` | Per-step state for rollback |
| `env_files` | Encrypted `.env` backups (AES-256-GCM) |
| `app_env_vars` | Encrypted per-app env vars |
| `app_metrics` | CPU/memory/status samples (30s interval, 7-day retention) |

Back up `deployer.db` and `DEPLOYER_ENV_ENCRYPTION_KEY` together — the key is required to decrypt `.env` snapshots.

---

## Required host tools

The deployer shells out to these tools — they must be in `PATH`:

| Tool | Required when |
|---|---|
| `git` | All app types |
| `pm2` | `node` and `python` apps (bare metal) |
| `docker`, `docker compose` | `docker` and `compose` apps |
| `nginx` | `nginxEnabled: true` on any app |
| `psql` | `dbEnabled: true` on any app |

Target OS: Ubuntu/Debian (nginx paths: `/etc/nginx/sites-available/` + `sites-enabled/`).
