# Phase Plan: Version check, Self-shutdown & Schedules

## Overview
This plan covers three new features: a VersionService + API (and MCP tool) to compare local vs upstream releases; a safe, auditable Self-shutdown operation to stop all managed apps and optionally delete installed artifacts; and a persistent Schedules subsystem to schedule deploy/stop/delete/update/self-update/self-shutdown tasks. The work is broken into 6 phases (foundation → version check → schedules schema/API → scheduler runtime → self-shutdown → polish). The critical path centers on DB migrations and the scheduler runtime because schedules need persistence and a reliable executor.

## Dependency Map

Phase 0 (Config & Safety)
  → Phase 2 (Schedules DB & API)
    → Phase 3 (Scheduler runtime + handlers)
      → Phase 4 (Self-shutdown)

Phase 1 (VersionService + MCP) can be done in parallel with Phase 2.

---

## Phase 0: Config & Safety
**Mode:** Sequential
**Depends on:** none
**Goal:** Add gating and safety controls so destructive features are opt-in and admin-protected.

1. Add config flags and env vars in `src/config.ts` and `.env.example` (e.g. `SCHEDULER_ENABLED`, `VERSION_UPSTREAM_URL`, `ALLOW_SELF_SHUTDOWN`, `ALLOW_SELF_SHUTDOWN_DELETE`) — these gate rollout and destructive operations.
2. Harden auth: ensure admin-only access for destructive endpoints (update `src/api/plugins/auth.plugin.ts`).
3. Add operational docs entries and a short runbook note for `self-shutdown` safety.

---

## Phase 1: VersionService + API + MCP
**Mode:** Sequential
**Depends on:** Phase 0
**Goal:** Provide `GET /apps/:appId/version` to return local and upstream latest version; expose an MCP tool to check versions programmatically.

### Sequential steps
1. Implement `src/services/version.service.ts` with functions:
   - `getLocalVersion(appId)` — read app metadata/package or configured version.
   - `getUpstreamLatest(appTypeOrRepo)` — call configured upstream (use `VERSION_UPSTREAM_URL`) with timeout/retries and cache results.
2. Add route `GET /apps/:appId/version` at `src/api/routes/version.route.ts` with zod response schema.
3. Register MCP method `check_app_version` in `src/mcp/server.ts` that calls the service.
4. Add unit and integration tests for service + route; instrument metrics for version checks.

---

## Phase 2: Schedules DB & API
**Mode:** Sequential
**Depends on:** Phase 0
**Goal:** Persist schedules (cron/expression) and expose CRUD APIs + MCP tools.

### Sequential steps
1. Design Drizzle schema for `schedules` (suggested fields: `id, app_id, type, payload JSON, cron, timezone, next_run, enabled, retry_policy, created_by, created_at`). Add to `src/db/schema.ts` or a new file.
2. Add migration file under `src/db/migrations/` and verify `postbuild` copies correctly.
3. Implement `src/services/schedule.service.ts` for CRUD and next-run calculation.
4. Add `src/api/routes/schedules.route.ts` + zod schemas in `src/api/schemas/` for POST/GET/PUT/DELETE.
5. Register MCP tools: `list_schedules`, `create_schedule`, `delete_schedule` in `src/mcp/server.ts`.
6. Add tests: migration test, unit tests for service, route integration tests.

---

## Phase 3: Scheduler runtime & task handlers
**Mode:** Parallel (up to 3 streams)
**Depends on:** Phase 2 (DB/migrations); Phase 1 helpful but not required
**Goal:** A runtime worker that executes scheduled tasks reliably and maps schedule types to existing orchestrator operations.

### Parallel streams
**Stream A — Scheduler worker**
- Implement `src/services/scheduler.service.ts` that on `server.addHook('onReady')` starts a scheduler loop (cron or next-run setTimeout), computes and persists `next_run`, and takes DB locks for execution to avoid duplicates.
- Ensure graceful shutdown on `onClose` and leader-election/locking if multiple instances run.

**Stream B — Task handlers**
- Map schedule `type` → handler functions:
  - `deploy` → `DeploymentService.deploy`
  - `stop` → `Pm2Service.stop` or Docker stop
  - `delete` → `AppService.delete`
  - `update` → update plan via orchestrator
  - `self-update` → `update-deployer` plan
  - `self-shutdown` → `SelfShutdownService.initiate`
- Add idempotency, retries, and structured logging (include `appId` and `scheduleId`).

**Stream C — API, MCP, and UI hooks**
- Finalize API & MCP tooling from Phase 2; add run-history endpoints and optional webhook/SSE for run events.
- Add example CLI/cURL snippets to README.

**Sync point:** Scheduler worker runs in dev, a representative schedule executes end-to-end, and tests validate correctness.

---

## Phase 4: Self-shutdown (safe, auditable)
**Mode:** Sequential
**Depends on:** Phase 3
**Goal:** Implement a safe, auditable self-shutdown flow that stops apps and optionally deletes installed artifacts after explicit confirmation.

### Sequential steps
1. Write a short spec document for `self-shutdown` operations (order, dry-run, confirm token, recovery guidance) and require admin gating via `DEPLOYER_ADMIN_TOKEN` + `ALLOW_SELF_SHUTDOWN`.
2. Implement `src/services/self-shutdown.service.ts` with modes:
   - `dryRun` — returns a plan of actions without executing
   - `execute` — stops orchestrator-managed apps, then optionally deletes files (only if `ALLOW_SELF_SHUTDOWN_DELETE` enabled)
   - always record an auditable log entry (consider `shutdown_logs` table)
3. Add admin route `POST /admin/self-shutdown` with body `{dryRun, deleteInstalled, confirmToken}` requiring confirm token and admin token.
4. Integrate schedule type `self-shutdown` with scheduler (must pass strict gating rules).
5. Test extensively in isolated environments; run dry-runs first.

---

## Phase 5: Polish, tests, docs, rollout
**Mode:** Parallel (3 streams)
**Depends on:** All previous phases
**Goal:** Production readiness: tests, docs, monitoring, and staged rollout.

**Stream A — Tests & CI**
- Add unit and integration tests; CI runs migrations against a clean SQLite DB; add smoke tests that run one scheduled job in a sandbox.

**Stream B — Docs & runbook**
- Update README and add admin runbook for `self-shutdown` (how to abort, recover, and prerequisites).

**Stream C — Monitoring & rollout**
- Add Prometheus metrics for schedule runs, failures, and self-shutdown events; add alerts. Roll out behind feature flags and enable in staging first.

---

## Critical Path
Phase 0 → Phase 2 (DB & API) → Phase 3 (Scheduler runtime + handlers) → Phase 4 (Self-shutdown)

## Risk Register
- Self-shutdown destructive risk — Mitigation: require `ALLOW_SELF_SHUTDOWN`, admin token, two-step confirmation, default to dry-run.
- Scheduler duplication/race — Mitigation: DB locks, leader election, idempotent handlers.
- Migration failure — Mitigation: small, reversible migrations; CI test on clean DB; rollback plan.
- Unauthorized schedules for destructive ops — Mitigation: RBAC checks (admins only for `delete`/`self-shutdown`).
- Upstream version check network failures — Mitigation: cache results and expose `lastChecked`/`lastError` in responses.

## Recommended Starting Point
1. Phase 0 (Config & Safety): add feature flags, env vars, and auth gating — fast, low-risk, required before enabling destructive features.
2. Parallel: Phase 1 (VersionService + API + MCP) — quick, low-risk, quick win that provides visibility into updates.
3. Then: Phase 2 (schedules DB & API) so the scheduler can persist runs and be tested safely.

---

## Next actions I can take for you
- Scaffold `src/services/version.service.ts`, `src/api/routes/version.route.ts`, and a MCP tool for version checks (quick win).
- Scaffold the `schedules` Drizzle schema + migration and a minimal `scheduler.service.ts` worker (larger change).

Choose which scaffold to start and I will implement it next.
