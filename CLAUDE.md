# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**@jsilvanus/deployer** is a Node.js/TypeScript REST API and MCP server for reversible, authenticated deployment of Node.js, Python, and Dockerized applications. It orchestrates git clone/pull, environment setup, database creation, migration runs, PM2/Docker process management, nginx/Traefik configuration, logging, and metrics — all as composable, snapshot-backed steps that can be rolled back on failure.

Can be installed globally via `npx @jsilvanus/deployer` or run as a Docker container.

## Commands

```bash
npm run dev          # Development server with hot reload (tsx watch)
npm run build        # TypeScript compilation to dist/ (tsconfig.build.json)
npm run postbuild    # Copies src/db/migrations/ to dist/db/migrations/ (runs after build)
npm start            # Run compiled production build
npm run test         # Run all tests (vitest)
npm run db:generate  # Generate Drizzle ORM migrations from schema changes
npm run db:migrate   # Apply pending migrations
```

Single test file: `npx vitest run path/to/test.ts`

## Architecture

### Request Flow

```
HTTP Request → Fastify (auth plugin) → Route Handler → Service(s) → SQLite (Drizzle ORM)
                                                     ↓
                                          DeploymentOrchestrator
                                                     ↓
                                          Plan (ordered Step list)
                                                     ↓
                                          Step.captureSnapshot() → Step.execute()
                                          (on failure: Step.rollback(snapshot) in reverse)
```

MCP tools at `/mcp` are thin wrappers over the same services as the REST API, using the same auth tokens. **MCP and REST API have full feature parity.**

### Core Concepts

**Steps** (`src/core/steps/*.step.ts`): The atomic unit of deployment. Each step implements `captureSnapshot()`, `execute()`, and `rollback(snapshot)`. Steps are stateless and composable.

**Plans** (`src/core/plans/*.plan.ts`): Ordered arrays of steps that define a deployment strategy. The `DeploymentOrchestrator` (`src/core/orchestrator.ts`) executes them sequentially.

**Snapshots**: Before each step executes, its state is serialized to JSON and stored in `deployment_snapshots` (SQLite). On rollback, snapshots are passed back to `step.rollback()`.

**Services** (`src/services/*.service.ts`): Business logic by domain — `app`, `deployment`, `git`, `env`, `pm2`, `docker`, `nginx`, `database`, `migration`, `metrics`, `traefik`, `app-env`.

### App Types

| Type | Runtime | Plans |
|---|---|---|
| `node` | PM2 | deploy-node, update-node |
| `python` | PM2 + interpreter | deploy-python, update-python |
| `docker` | Docker Compose (git repo) | deploy-docker, update-docker |
| `compose` | Docker Compose (inline YAML) | deploy-compose, update-compose |

Special plan: `update-deployer` — used for self-update; adds `npm-build` step between git pull and pm2 restart.

### Authentication

Two-tier bearer token auth (`src/api/plugins/`):
- **Admin token** (`DEPLOYER_ADMIN_TOKEN`): Full access to all routes
- **Per-app API keys**: Scoped to a single app, returned once at creation, compared with constant-time SHA-256 hash

### Database

SQLite via Drizzle ORM. Schema in `src/db/schema.ts`. Six tables:

| Table | Purpose |
|---|---|
| `apps` | App config, hashed API keys |
| `deployments` | Deployment history |
| `deployment_snapshots` | Per-step state for rollback |
| `env_files` | Encrypted `.env` backups |
| `app_env_vars` | Per-app encrypted env vars |
| `app_metrics` | CPU/memory/status time-series (30s samples, 7-day TTL) |

Migrations auto-run on startup. Timestamps as `integer` with `mode: 'timestamp'`; JSON as text; encrypted fields as base64.

Migration files are in `src/db/migrations/` with journal at `src/db/migrations/meta/_journal.json`. After `npm run build`, migrations are copied to `dist/db/migrations/` by the `postbuild` script.

### Encryption

`.env` backups and per-app env vars are AES-256-GCM encrypted using `DEPLOYER_ENV_ENCRYPTION_KEY` (64 hex chars = 32 bytes). Logic in `src/services/env.service.ts` and `src/services/app-env.service.ts`.

### Metrics Poller

`MetricsService` starts a 30-second polling loop via `server.addHook('onReady')`. Samples all apps (PM2 or Docker), stores in `app_metrics`. Runs 7-day TTL cleanup on startup. Stopped on `onClose`.

### Traefik Integration

`TraefikService` (`src/services/traefik.service.ts`) manages:
- Mode detection: `nginx -v` succeeds on bare metal → `behind-nginx`; fails in Docker → `standalone`
- Compose content generation for Traefik itself
- Per-app Traefik label override generation (`docker-compose.traefik.yml`)
- Internal network override generation (`docker-compose.internal.yml`)

`POST /setup/traefik` creates/updates a `compose`-type app named `traefik` and deploys it. Stores `_TRAEFIK_MODE` as an encrypted app env var.

## Steps Reference

| Step | File | Reversible | Notes |
|---|---|---|---|
| `preflight` | preflight.step.ts | No | Disk space, path validation |
| `git-clone` | git-clone.step.ts | Yes | `rm -rf` on rollback |
| `git-pull` | git-pull.step.ts | Yes | `git reset --hard` on rollback |
| `env-setup` | env-setup.step.ts | Yes | Encrypted `.env` backup |
| `database-create` | database-create.step.ts | Yes | `DROP DATABASE` opt-in |
| `migration-up` | migration-up.step.ts | Yes | Runs `.down.sql` files |
| `pm2-start` | pm2-start.step.ts | Yes | Detects node/python entry point |
| `pm2-restart` | pm2-restart.step.ts | Yes | |
| `docker-build` | docker-build.step.ts | Yes | `docker rmi` on rollback |
| `docker-compose-up` | docker-compose-up.step.ts | Yes | Generates traefik/internal overrides |
| `compose-write` | compose-write.step.ts | Yes | Writes `docker-compose.yml` from stored content |
| `nginx-configure` | nginx-configure.step.ts | Yes | Skipped if no domain/nginx |
| `npm-build` | npm-build.step.ts | No | `npm install` + conditional `npm run build` |

## Routes Reference

| Route file | Endpoints |
|---|---|
| `health.route.ts` | `GET /health` |
| `apps.route.ts` | CRUD `/apps`, `/apps/:id/env` CRUD |
| `deployments.route.ts` | deploy, update, rollback, migration |
| `status.route.ts` | `GET /apps/:id/status` |
| `logs.route.ts` | `GET /apps/:id/logs`, `GET /apps/:id/logs/stream` (SSE) |
| `metrics.route.ts` | `GET /apps/:id/metrics`, `GET /metrics` (Prometheus) |
| `setup.route.ts` | `POST /setup/traefik`, `/setup/self-register`, `/setup/self-update` |

## MCP Tools Reference

All tools in `src/mcp/server.ts`. Full parity with REST API:

`list_apps`, `register_app`, `update_app_config`, `delete_app`, `get_app_status`, `get_app_logs`, `get_app_metrics`, `deploy_app`, `update_app`, `rollback_app`, `get_deployment`, `list_deployments`, `get_deployment_snapshots`, `get_app_env_keys`, `set_app_env`, `delete_app_env`, `run_migrations`, `setup_traefik`, `self_register`, `self_update`

## Key Conventions

**File naming**: `*.step.ts`, `*.service.ts`, `*.route.ts`, `*.schema.ts`, `*.plan.ts`

**Async deployments**: Return `202 Accepted` with a `deploymentId`; client polls `/deployments/:id` for status.

**Shell commands**: Use `execa` (not `child_process`) for git, pm2, docker, psql, nginx operations. Exception: SSE log streaming uses Node's `child_process.spawn` for process lifecycle control.

**Validation**: Zod for config (`src/config.ts`) and request bodies (`src/api/schemas/`). Fails fast at startup.

**Logging**: Pino with structured fields — always include `appId`, `deploymentId`, `stepName` where relevant. Pretty-printed when `NODE_ENV=development`.

**Error propagation**: Services throw typed errors (see `src/errors.ts`); the Fastify error handler converts them to HTTP responses.

**Row mapping**: DB rows are always mapped to TypeScript interfaces via `rowToX()` helpers.

**SSE streaming**: Log stream endpoints use `reply.hijack()` to take control of the raw socket and write `data: <line>\n\n` events.

**internalNetwork**: Only meaningful for `docker` and `compose` apps. Defaults to `false` for `node`/`python`. Updates to this field are silently ignored for `node`/`python` apps.

## Required Host Tools

| Tool | Required when |
|---|---|
| `git` | All app types |
| `pm2` | `node` and `python` apps |
| `docker`, `docker compose` | `docker` and `compose` apps |
| `nginx` | `nginxEnabled: true` on any app |
| `psql` | `dbEnabled: true` on any app |

Target OS: Ubuntu/Debian (nginx paths: `/etc/nginx/sites-available/`, `/etc/nginx/sites-enabled/`).

## Environment Variables

Required at runtime:
- `DEPLOYER_ADMIN_TOKEN` — min 16 chars
- `DEPLOYER_ENV_ENCRYPTION_KEY` — exactly 64 hex chars (AES-256-GCM key)

Optional with defaults: `DEPLOYER_PORT` (3000), `DEPLOYER_ALLOWED_DEPLOY_PATHS` (/srv/apps), `DEPLOYER_DB_PATH` (./deployer.db), `LOG_LEVEL` (info), `NODE_ENV`.

## npm Publish

Package name: `@jsilvanus/deployer`. Published files: `dist/`, `bin/`, `.env.example`. Run `npm publish` — `prepublishOnly` triggers `npm run build` (which also runs `postbuild` to copy migrations).

Binary entry points:
- `deployer` (`bin/deployer.js`) — loads `.env` from cwd, starts server; `deployer setup [...]` runs the wizard
- `deployer-setup` (`bin/setup.js`) — bare-metal interactive setup wizard (requires sudo)
