# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**deployer** is a Node.js/TypeScript REST API and MCP (Model Context Protocol) server for reversible, authenticated deployment of Node.js and Dockerized applications. It orchestrates git clone/pull, environment setup, database creation, migration runs, PM2/Docker process management, and nginx configuration — all as composable, snapshot-backed steps that can be rolled back on failure.

## Commands

```bash
npm run dev          # Development server with hot reload (tsx watch)
npm run build        # TypeScript compilation to dist/ (tsconfig.build.json)
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

MCP tools at `/mcp` are thin wrappers over the same services as the REST API, using the same auth tokens.

### Core Concepts

**Steps** (`src/core/steps/*.step.ts`): The atomic unit of deployment. Each step implements `captureSnapshot()`, `execute()`, and `rollback(snapshot)`. Steps are stateless and composable.

**Plans** (`src/core/plans/*.plan.ts`): Ordered arrays of step names that define a deployment strategy (e.g., `deployNodePlan`, `updateDockerPlan`). The `DeploymentOrchestrator` (`src/core/orchestrator.ts`) resolves steps from the registry and executes them sequentially.

**Snapshots**: Before each step executes, its current state is serialized to JSON and stored in `deployment_snapshots` (SQLite). On rollback, these snapshots are passed back to `step.rollback()`.

**Services** (`src/services/*.service.ts`): Business logic grouped by domain — `app`, `deployment`, `git`, `env`, `pm2`, `docker`, `nginx`, `database`, `migration`. Services are injected with `Db`, logger, and config.

### Authentication

Two-tier bearer token auth (`src/api/plugins/`):
- **Admin token** (`DEPLOYER_ADMIN_TOKEN`): Full access, set in env
- **Per-app API keys**: Scoped to a single app, returned once at creation, compared with constant-time SHA-256 hash

### Database

SQLite via Drizzle ORM. Schema in `src/db/schema.ts`. Five tables: `apps`, `deployments`, `deployment_snapshots`, `env_files`, `app_env_vars`. Migrations auto-run on startup. Timestamps stored as `integer` with `mode: 'timestamp'`; JSON stored as text and parsed on read; encrypted fields stored as base64.

### Encryption

`.env` file backups are AES-256-GCM encrypted using `DEPLOYER_ENV_ENCRYPTION_KEY` (64 hex chars = 32 bytes). Logic lives in `src/services/env.service.ts`.

## Key Conventions

**File naming**: `*.step.ts`, `*.service.ts`, `*.route.ts`, `*.schema.ts`, `*.plan.ts`

**Async deployments**: Return `202 Accepted` with a `deploymentId`; client polls `/deployments/:id` for status.

**Shell commands**: Use `execa` (not `child_process`) for git, pm2, docker, psql, nginx operations.

**Validation**: Zod for both config (`src/config.ts`) and request bodies (`src/api/schemas/`). Config is validated at startup and fails fast.

**Logging**: Pino with structured fields — always include `appId`, `deploymentId`, `stepName` where relevant. Pretty-printed when `NODE_ENV=development`.

**Error propagation**: Services throw typed errors (see `src/errors.ts`); the Fastify error handler plugin converts them to standardized HTTP responses.

**Row mapping**: DB rows are always mapped to TypeScript interfaces via `rowToX()` helpers (e.g., `rowToApp()`, `rowToDeployment()`).

## Required Host Tools

The deployer shells out to these tools — they must be in PATH on the host:
- `git`, `pm2`, `docker`, `docker compose`, `nginx`, `psql`

Target OS is Ubuntu/Debian (nginx paths: `/etc/nginx/sites-available/`, `/etc/nginx/sites-enabled/`).

## Environment Variables

See `.env.example`. Required at runtime:
- `DEPLOYER_ADMIN_TOKEN` — min 16 chars
- `DEPLOYER_ENV_ENCRYPTION_KEY` — exactly 64 hex chars (AES-256-GCM key)

Optional with defaults: `DEPLOYER_PORT` (3000), `DEPLOYER_ALLOWED_DEPLOY_PATHS` (/srv/apps), `DEPLOYER_DB_PATH` (./deployer.db), `LOG_LEVEL` (info), `NODE_ENV`.
