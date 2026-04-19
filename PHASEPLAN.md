### Sequential steps
### Sequential steps
### Parallel streams
### Sequential steps
## Risk Register
## Recommended Starting Point
# Phase Plan: OpenAPI, Routes & Migrations — Versions, Registry Test, Shutdown, Schedules, Cache

## Overview
This plan delivers a concrete implementation path to: (1) update the OpenAPI spec with the new endpoints we agreed on, (2) add server routes and MCP tools, and (3) land the required DB migrations. The work is split into 6 phases and isolates the spec work from DB and runtime changes so the API shape is reviewable before server code lands. Critical path: OpenAPI → DB migration(s) → route scaffolds → service logic → tests/CI.

## Dependency Map

OpenAPI spec
  → DB migration(s) (lastModified, optional run history)
    → Route scaffolding (routes + schemas)
      → Service implementations (version, registry test, shutdown, app.lastModified)
        → Tests, validation, rollout

---

## Phase 0: Align & prepare ✅ 🔒
**Mode:** Sequential
**Depends on:** none
**Goal:** Agree API shapes, auth rules, and create a working branch; add feature flags so destructive behavior is opt-in.

Sequential steps
- [x] Create a feature branch (e.g., `feat/api-versions-registry-shutdown`).
- [x] Finalize security model in writing: admin token = full access; app-scoped API keys = per-app safe operations (version check, shutdown/stop/restart, per-app schedule CRUD, cache purge). Document exact auth requirements for each path in the spec. (see `docs/API_AUTH.md`)
- [x] Add feature flags / env vars to `src/config.ts` and `.env.example`: `ALLOW_SELF_SHUTDOWN`, `ALLOW_PERSIST_REGISTRY_CREDENTIALS` (default false), `VERSION_CHECK_CACHE_TTL_SECONDS`.
- [x] Add a working copy of `openapi.yaml` (branch-off root file) named `openapi.work.yaml` to iterate safely.

**Deliverable:** feature branch + `openapi.work.yaml` with top-level security section and path stubs.

---

## Phase 1: OpenAPI spec changes (authoritative first)
**Mode:** Sequential
**Depends on:** Phase 0
**Goal:** Add the new endpoints and schemas to the OpenAPI definition so the team can review contract-first.

Sequential steps
- [x] Add paths (and example request/response schema definitions) to `openapi.work.yaml` / `openapi.yaml` (drafted).
- [x] Add components/schemas: `VersionResponse`, `VersionDiffResponse`, `RegistryTestRequest`, `RegistryTestResponse`, `ShutdownRequest`, `OperationResponse`, `CachePurgeRequest`, `PaginatedVersionsResponse`.
- [x] Document security requirements per-path (admin vs app-key). Provide examples for `docker`, `npm`, `pypi`, and `git` registry test payloads. (see `docs/API_AUTH.md`)
- [ ] Run an OpenAPI validator (e.g., `spectral` or `openapi-cli validate`) and fix schema issues.
- [ ] Publish the spec change as the authoritative contract (merge `openapi.work.yaml` -> `openapi.yaml`) and generate TypeScript types if desired (optional: `openapi-typescript` or use Zod manual schemas).

**Deliverable:** PR-ready `openapi.yaml` with full examples and security annotations.

---

## Phase 2: DB migrations (minimal, reversible)
**Mode:** Sequential
**Depends on:** Phase 1 (needs schema to include `lastModified` in `App` schema)
**Goal:** Add DB changes required by the new API surface, keep migrations small and reversible.

Sequential steps
1. Add `last_modified` column to `apps` table (SQLite integer epoch). Migration SQL (example):

   ALTER TABLE apps ADD COLUMN last_modified INTEGER DEFAULT (strftime('%s','now')) NOT NULL;

2. (Optional) Add `schedule_runs` table to record schedule execution history and `shutdown_logs` for self-shutdown audit if not present. Keep those in separate migration files to keep scope small.
3. Add migration files to `src/db/migrations/` and ensure `postbuild` copies migrations to `dist/db/migrations/` as existing build flow requires.
4. Add a simple rollback plan in the migration notes (how to remove column if needed).

**Deliverable:** migration files + migration test in CI (run on clean DB).

---

## Phase 3: Route scaffolding & registration
**Mode:** Parallel (3 streams)
**Depends on:** Phase 2 (apps.last_modified exists); Phase 1 (API contract)
**Goal:** Add route files and Zod schemas; wire them into the server as non-destructive stubs that call services.

Parallel streams (max 3)

**Stream A — Version endpoints**
- Create `src/api/routes/version.route.ts` with handlers:
  - `GET /apps/:appId/version` — calls `VersionService.getCurrent(appId)`
  - `GET /apps/:appId/version/latest` — calls `VersionService.getLatest(appId, { refresh })`
  - `GET /apps/:appId/versions` — calls `DeploymentService.listVersions(appId, pagination)`
  - Add Zod request/response schemas in `src/api/schemas/version.schema.ts` (mirror OpenAPI types).

**Stream B — Registry test & credentials handling**
- Create `src/api/routes/registry.route.ts` implementing `POST /apps/:appId/registry/test`:
  - Validate transient credentials; call `RegistryService.testCredentials(provider, target, credentials)`.
  - Return diagnostic results; do NOT persist credentials.
  - Ensure `PATCH /apps/:appId` accepts `persistCredentials=true` to store encrypted credentials (server-side only).

**Stream C — Shutdown, per-app schedules, cache purge**
- Create `src/api/routes/shutdown.route.ts` for `POST /apps/:appId/shutdown` (app-key allowed for non-destructive actions; admin required for destructive) and `src/api/routes/cache.route.ts` for `POST /apps/:appId/cache/purge`.
- Create `src/api/routes/app-schedules.route.ts` to proxy calls to the central schedules service for the given `appId`.

Sync point: All route files compile and register in `src/api/server.ts` / `src/api/routes/index` and basic smoke tests pass.

---

## Phase 4: Services & secure logic
**Mode:** Parallel (3 streams)
**Depends on:** Phase 3
**Goal:** Implement the real behavior behind the routes: version checks, registry testing, persisting credentials (encrypted), app.lastModified updates, and shutdown actions.

Parallel streams

**Stream A — VersionService & caching**
- Implement `src/services/version.service.ts`: read local metadata, cached upstream queries, `refresh=true` logic with timeout, integrate with MCP tool.
- Ensure results update `App.lastModified` when a config or version-affecting change is applied.

**Stream B — RegistryService test & credentials storage**
- Implement `src/services/registry.service.ts` with providers: `docker`, `npm`, `pypi`, `git` (use `execa` for `git ls-remote`, registry APIs or `node-fetch` for npm/pypi, and Docker Registry HTTP API v2 for docker manifests). Keep timeouts and surface diagnostics.
- Implement secure persistence: `AppService.storeRegistryCredentials(appId, encryptedPayload)` using existing AES-256-GCM key code paths (see `src/services/env.service.ts` for patterns); never return full tokens in routes (return masked string).

**Stream C — ShutdownService, AppService.lastModified, cache purge**
- Implement `src/services/shutdown.service.ts` orchestrating pm2/docker stop/restart via existing `pm2.service` / `docker.service` functions. Capture snapshots for rollback where meaningful.
- Implement `AppService.updateLastModified(appId)` and call it from any mutating endpoints (schedules create/update, credentials persist, config change, deployments).
- Implement cache purge integration hooks: clear in-memory caches, generated config files, and optionally call configured CDN/provider purge (admin-only).

Test coverage: add unit tests for provider code paths (mock network calls) and integration tests for full flow in CI sandbox.

---

## Phase 5: Validation, tests, docs, CI
**Mode:** Parallel (3 streams)
**Depends on:** Phase 4
**Goal:** Validate OpenAPI, run tests, update docs, and prepare a PR.

Streams
- Tests & CI: run migrations on clean DB, run unit/integration tests for new endpoints, add schema validation tests that the server responses match `openapi.yaml`.
- Docs: update `README.md` and `openapi.yaml` examples; add brief dev notes on how to test registry providers locally.
- Release: create PR, include migration notes, add reviewers, and provide rollout plan with feature flags.

Deliverable: passing CI, PR with spec + code + migration, and a short runbook for any destructive operations.

---

## Critical Path
1 → 2 → 3 → 4 → 5 (OpenAPI spec → DB migrations → route scaffolds → services → tests/PR)

## Risk Register
- Secrets leakage: Mitigation — never log secrets, persist encrypted only when explicitly requested, mask responses.
- Registry network flakiness: Mitigation — cached results, `?refresh=true` opt-in, timeouts and clear diagnostic messages.
- Destructive shutdowns: Mitigation — require `ALLOW_SELF_SHUTDOWN`, admin token + explicit confirm token, dry-run mode.
- DB migration failures: Mitigation — small reversible migrations, CI-run on clean DB, rollback notes.
- Race conditions for per-app schedule operations: Mitigation — transactions, foreign keys, and schedule-run locking.

## Recommended Starting Point
1. Implement and land the OpenAPI additions (`Phase 1`) so reviewers can approve the contract. This is low-risk and enables parallel server work.
2. Add the small `last_modified` DB migration (`Phase 2`) next — simple, reversible, and required for cache/validation headers.
3. Scaffold route files and Zod schemas (`Phase 3`, streams A–C) as non-destructive stubs that wire into services.

---

## Files & artifacts to create (examples)
- `openapi.yaml` (updated) and `openapi.work.yaml` (draft)
- `src/api/schemas/version.schema.ts`, `src/api/routes/version.route.ts`
- `src/api/routes/registry.route.ts`, `src/services/registry.service.ts`
- `src/api/routes/shutdown.route.ts`, `src/services/shutdown.service.ts`
- `src/api/routes/app-schedules.route.ts` (per-app convenience routes)
- `src/api/routes/cache.route.ts` (cache/purge endpoint)
- `src/db/migrations/XXXX_add_last_modified.sql`
- Unit/integration tests under `test/` and an OpenAPI validation job in CI

## Recommended next action (I can do this)
- Draft the OpenAPI additions for review (I will create `openapi.work.yaml` with the paths and example schemas). If you approve, I will then scaffold route files and the `last_modified` migration.

---

Place this file at `PHASEPLAN.md` as the canonical implementation plan for the API+routes+migrations work.
