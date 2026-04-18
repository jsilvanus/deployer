# deployer

A self-hosted deployment orchestrator with a REST API and MCP server. Manages deploying, updating, and **reversibly rolling back** Node.js and Dockerized applications on a Linux server.

Every deployment step captures a snapshot of the state it is about to change. If any step fails — or if you trigger a rollback later — each step is undone in reverse order: git is reset, `.env` files are restored from an encrypted backup, migrations are rolled back, and nginx configs are rewritten.

---

## Requirements

### Runtime

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** | ESM support required |
| **npm ≥ 10** | Comes with Node.js 20 |

### Host tools (must be in `PATH`)

| Tool | Used for | Required when |
|---|---|---|
| `git` | Clone, pull, reset | Always |
| `pm2` | Process management | Bare-metal Node.js apps |
| `docker` | Build and run containers | Docker apps |
| `nginx` | Reverse proxy | `nginxEnabled: true` on any app |
| `psql` | Database provisioning | `dbEnabled: true` on any app |

### System

| Requirement | Notes |
|---|---|
| **Ubuntu / Debian Linux** | Nginx config uses `/etc/nginx/sites-available` + `sites-enabled` symlinks |
| **PostgreSQL running** | The deployer connects to an existing instance — it does **not** install or start Postgres |
| Write access to `/etc/nginx/sites-available` | Required for nginx management; run deployer as root or configure `sudoers` |
| SSH key or HTTPS credentials for git | Needed to clone private repositories |

---

## Installation

```bash
git clone <this-repo>
cd deployer
npm install
cp .env.example .env
# edit .env — see Configuration below
npm run dev       # development (hot reload)
npm run build && npm start   # production
```

On first start, the deployer automatically applies all pending SQLite migrations.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in:

```
DEPLOYER_PORT=3000
DEPLOYER_ADMIN_TOKEN=<strong-random-secret>
DEPLOYER_ENV_ENCRYPTION_KEY=<64-hex-chars>
DEPLOYER_ALLOWED_DEPLOY_PATHS=/srv/apps
DEPLOYER_DB_PATH=./deployer.db
LOG_LEVEL=info
NODE_ENV=production
```

| Variable | Required | Description |
|---|---|---|
| `DEPLOYER_ADMIN_TOKEN` | Yes | Admin bearer token. Minimum 16 characters. Grants full access to all routes. |
| `DEPLOYER_ENV_ENCRYPTION_KEY` | Yes | 64 hex characters (32 bytes). Used for AES-256-GCM encryption of `.env` snapshots. **If lost, all rollback `.env` backups become unreadable.** Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEPLOYER_ALLOWED_DEPLOY_PATHS` | No | Comma-separated list of allowed path prefixes for `deployPath`. Prevents path traversal. Default: `/srv/apps` |
| `DEPLOYER_DB_PATH` | No | Path to the SQLite database file. Default: `./deployer.db` |
| `DEPLOYER_PORT` | No | HTTP port. Default: `3000` |
| `LOG_LEVEL` | No | Pino log level: `trace`, `debug`, `info`, `warn`, `error`. Default: `info` |
| `NODE_ENV` | No | Set to `development` for pretty-printed logs. |

---

## Authentication

Two-tier bearer token system:

### Admin token
Set via `DEPLOYER_ADMIN_TOKEN`. Full access to all routes and all apps.

### Per-app API keys
When you register an app (`POST /apps`), the server generates a random 64-char hex API key and returns it **once** in the response. Store it — it cannot be retrieved again.

A per-app key authorises operations **only for that specific app**:
- Deploy, update, rollback
- Read deployment history and status

This allows a CI/CD pipeline or an AI agent scoped to one app to operate without admin access.

---

## PostgreSQL database provisioning

When `dbEnabled: true` is set on an app, the deployer provisions a dedicated database and user during the deploy step.

**Each app gets:**
- Its own database (named `dbName`, or the app name if not specified)
- Its own PostgreSQL user (same name as the database)
- `GRANT ALL PRIVILEGES` on that database for that user

**Password resolution order:**
1. `dbPassword` option passed in the deploy request body
2. `DB_PASSWORD` environment variable on the deployer host
3. Falls back to the database name *(insecure — set `DB_PASSWORD` in production)*

**The deployer does not install or start PostgreSQL.** It connects to an already-running Postgres instance using the `psql` CLI as the `postgres` superuser (or the user running the deployer process).

**Rollback:** Dropping a database is destructive and opt-in. Pass `"allowDbDrop": true` in the deploy/rollback request to enable it. By default, database rollback logs a warning and skips.

---

## App types

### `node` — bare-metal Node.js via PM2

Deploy plan: `git clone → .env setup → database create → migrations → pm2 start → nginx`

Update plan: `git pull → .env update → migrations → pm2 restart → nginx`

The entry point is read from `package.json`'s `main` field, falling back to `index.js`.

### `docker` — containerised via Docker Compose

Deploy plan: `git clone → .env setup → database create → migrations → docker build → docker compose up → nginx`

Update plan: `git pull → .env update → migrations → docker build → docker compose up → nginx`

Set `dockerCompose: true` when registering the app. The deployer runs `docker compose up -d --build` from the deploy path.

---

## REST API

All routes except `GET /health` require `Authorization: Bearer <token>`.

Deployments are **asynchronous** — trigger routes return `202 Accepted` with a `deploymentId`. Poll `GET /deployments/:id` for status.

### Health

```
GET /health
```

### Apps

```
GET    /apps                        List all apps (admin only)
POST   /apps                        Register a new app → returns app + apiKey
GET    /apps/:appId                 Get app details
PATCH  /apps/:appId                 Update app config (branch, domain, port, etc.)
DELETE /apps/:appId                 Unregister app (does not stop or remove it)
GET    /apps/:appId/status          Live runtime status (PM2 info or Docker container state)
```

### Deployments

```
POST   /apps/:appId/deploy                  Initial deploy → 202 + deploymentId
POST   /apps/:appId/update                  Update (pull + restart) → 202
POST   /apps/:appId/rollback                Rollback most recent successful deployment → 202
GET    /apps/:appId/deployments             Deployment history

GET    /deployments/:deploymentId           Deployment details + step log
GET    /deployments/:deploymentId/snapshots All step snapshots (shows what rollback would revert)
POST   /deployments/:deploymentId/rollback  Rollback a specific deployment → 202
```

### Migrations

```
POST /apps/:appId/migrations/run    Body: { "direction": "up"|"down" }
```

### MCP

```
POST /mcp    MCP Streamable HTTP (tool calls from AI agents)
GET  /mcp    MCP SSE stream
```

---

## Deploy request body

```jsonc
{
  "triggeredBy": "api",        // "api" or "mcp"
  "envVars": {                 // written/merged into .env at deploy path
    "NODE_ENV": "production",
    "PORT": "4000",
    "DATABASE_URL": "postgres://myapp:pass@localhost/myapp"
  },
  "dbPassword": "secret",      // password for the new Postgres user (optional)
  "allowDbDrop": false         // set true to allow DROP DATABASE on rollback
}
```

---

## Registering an app

```bash
curl -X POST http://localhost:3000/apps \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api",
    "type": "node",
    "repoUrl": "git@github.com:you/my-api.git",
    "branch": "main",
    "deployPath": "/srv/apps/my-api",
    "nginxEnabled": true,
    "domain": "api.example.com",
    "port": 4000,
    "dbEnabled": true,
    "dbName": "my_api"
  }'
```

**Save the `apiKey` from the response.** It is shown only once.

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier. Lowercase, hyphens allowed. Used as PM2 process name and Docker image name. |
| `type` | Yes | `"node"` or `"docker"` |
| `repoUrl` | Yes | Git clone URL (SSH or HTTPS) |
| `branch` | No | Branch to deploy. Default: `main` |
| `deployPath` | Yes | Absolute path on the server where the repo will be cloned |
| `dockerCompose` | No | Use `docker compose` instead of a plain `docker run`. Default: `false` |
| `nginxEnabled` | No | Manage an nginx reverse proxy block for this app. Default: `false` |
| `domain` | No | Domain name for the nginx `server_name` directive |
| `port` | No | Upstream port for nginx `proxy_pass`. Default: `3000` |
| `dbEnabled` | No | Provision a Postgres database and user on deploy. Default: `false` |
| `dbName` | No | Database name. Defaults to `name` |

---

## Reversibility

Every step records a snapshot before it runs:

| Step | What is snapshotted | How rollback works |
|---|---|---|
| `git-clone` | Repository path | `rm -rf` the cloned directory |
| `git-pull` | Commit hash before pull | `git reset --hard <hash>` |
| `env-setup` | Full `.env` contents (AES-256-GCM encrypted) | Decrypt and restore previous file |
| `database-create` | Whether the DB was newly created | `DROP DATABASE` + `DROP USER` (opt-in) |
| `migration-up` | List of migration files applied | Run corresponding `.down.sql` files |
| `pm2-start` | Process name | `pm2 delete <name>` |
| `pm2-restart` | Commit hash + process status | `git reset --hard` + `pm2 restart` |
| `docker-build` | Image name and tag | `docker rmi <new-tag>` |
| `docker-compose-up` | Compose path and service names | `docker compose down` |
| `nginx-configure` | Full previous config text | Write back previous config + `nginx -s reload` |

Inspect snapshots for any deployment:
```bash
GET /deployments/:id/snapshots
```

---

## MCP (AI agent integration)

The MCP server runs on the same port at `/mcp` using the Streamable HTTP transport (stateless mode). Point any MCP-compatible client (Claude Desktop, Claude Code, custom agent) at:

```
http://localhost:3000/mcp
```

Available tools:

| Tool | Description |
|---|---|
| `register_app` | Register an app and receive its API key |
| `deploy_app` | Initial deploy with optional env vars |
| `update_app` | Pull latest code and restart |
| `rollback_app` | Revert by app name or specific deployment ID |
| `get_app_status` | Live PM2 or Docker runtime status |
| `list_apps` | List all registered apps |
| `get_deployment` | Poll deployment status by ID |
| `list_deployments` | Deployment history, optionally filtered by app |
| `get_deployment_snapshots` | Inspect what a rollback would revert |
| `run_migrations` | Manually run migrations up or down |

---

## Migration runners

The deployer auto-detects the migration tool used by the deployed app:

| Detection | Runner | Up command | Down command |
|---|---|---|---|
| `drizzle.config.ts` or `drizzle.config.js` present | Drizzle | `npx drizzle-kit migrate` | Warning only (no built-in rollback) |
| `prisma/schema.prisma` present | Prisma | `npx prisma migrate deploy` | Warning only (Prisma has no native rollback) |
| `migrations/` directory present | Raw SQL | Runs `*.sql` files in alphabetical order | Runs matching `*.down.sql` files in reverse |

For raw SQL rollback to work, provide a `.down.sql` file for each `.sql` migration (e.g. `0002_add_users.sql` → `0002_add_users.down.sql`).

---

## Concurrency

Only one deployment can run per app at a time. If a deployment is already running, subsequent deploy/update/rollback requests return `409 Conflict`.

---

## Data storage

The deployer stores its own state in a SQLite database (default: `./deployer.db`). Four tables:

- `apps` — registered app configs and hashed API keys
- `deployments` — deployment history with status and git hashes
- `deployment_snapshots` — per-step snapshots used for rollback
- `env_files` — encrypted `.env` backups (AES-256-GCM)

The database file is created automatically on first start. Back it up along with `DEPLOYER_ENV_ENCRYPTION_KEY` — the key is required to decrypt `.env` snapshots.
