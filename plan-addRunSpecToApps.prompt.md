## Plan: Add runSpec to apps and support cronned ephemeral runs

TL;DR: Don’t create a new install type. Add a structured `runSpec` to every app (or infer it for existing apps) that describes how to run the app for ephemeral jobs and how to run it persistently. Let the scheduler use app.runSpec (with optional per-schedule overrides) to execute cronned one-off jobs. Reuse existing `schedules`, `schedule_runs`, and `schedule_locks` for storage, locking, and history.

**Steps**
1. Define RunSpec shape (small, structured). Include: runtime (node|python|image|compose|command), entry/command (string or array), service (compose service), image, env map, timeoutSec, ephemeral boolean, optional resource hints. Disallow `command` mode by default (admin-only).
2. DB + types: add `run_spec` (text JSON) to `apps` in [src/db/schema.ts](src/db/schema.ts) and add `runSpec` type in [src/types/app.ts](src/types/app.ts). Provide a Drizzle migration file.
3. Defaulting for existing apps: write a migration or on-read inference so apps without runSpec get a safe inferred runSpec based on `app.type` and `primaryService`:
   - node/python → runtime=node/python, command inferred from package.json or entrypoint; ephemeral true for scheduled runs.
   - compose/docker → runtime=compose, service=primaryService (or first service); use `docker compose run --rm` semantics.
   - image → runtime=image, image from packageName/registryUrl.
4. API surface: accept `runSpec` in app create/update endpoints (validate). Allow per-schedule override via `schedules.payload.runSpec` but require more privileges to use `command` mode. Add `POST /schedules/:id/trigger` to the HTTP API to mirror MCP `trigger_schedule`.
5. Scheduler execution: in [src/services/scheduler.service.ts](src/services/scheduler.service.ts) add support for `type='run'`. Behavior:
   - Load schedule payload.runSpec if present else app.runSpec (fail if none).
   - Pass runSpec to a new `RunExecutor` service which executes ephemeral jobs and returns result (exit, stdout/stderr summary).
   - Record run status/details into `schedule_runs` and update nextRun via existing `ScheduleService`.
6. RunExecutor service: add [src/services/run-executor.service.ts](src/services/run-executor.service.ts) that abstracts execution modes:
   - image: `docker run --rm` with env/args and timeout.
   - compose: `docker compose run --rm <service>` (use [src/services/docker.service.ts](src/services/docker.service.ts) helpers).
   - node/python: spawn `node`/`python` in app.deployPath with `execa`, capturing stdout/stderr and applying timeout.
   - command: spawn arbitrary shell only when allowed (admin, explicit opt-in).
   Always enforce timeouts and capture limited logs (store summaries, not entire logs).
7. Safety & policy: default to safe modes (image/compose/node). Disallow raw shell commands for app-scoped API keys; require admin token to set command-mode runSpec; enforce timeouts & resource hints; sanitize env inputs.
8. Tests & CI: unit tests for RunExecutor, scheduler run flow, and schedule payload override. Integration test that creates an app with runSpec, schedules it, triggers it (in-process or via MCP), and asserts schedule_runs status.
9. Docs & examples: update docs (new docs/SCHEDULES.md) and add an example in `examples/` showing a cronned image and a cronned node run.
10. Rollout & migration: add migration to populate run_spec for existing apps where safe; start with feature flag `SCHEDULER_ENABLED` and consider a canary rollout.

**RunSpec (suggested fields)**
- runtime: node | python | image | compose | command
- command: string[] — argv for node/python/command modes
- image: string — for image mode
- service: string — for compose service
- env: Record<string,string>
- timeoutSec: number (default 300)
- ephemeral: boolean (default true for scheduled runs)
- resources: { cpus?: number, memoryMb?: number } (optional hints)

**Defaulting / inference rules**
- node/python: if runSpec absent, infer runtime=node/python and default command from package.json `main` or `start` script; scheduled runs run the command directly (not via pm2).
- compose/docker: infer runtime=compose and service=primaryService; use compose run --rm.
- image: infer runtime=image from packageName/registryUrl.
Note: Persistent (pm2) deployments remain controlled by existing deploy plans; runSpec controls ephemeral job runs.

**Relevant files to change**
- [src/db/schema.ts](src/db/schema.ts) — add `run_spec` to `apps` and create migration.
- [src/types/app.ts](src/types/app.ts) — add `RunSpec` type and `runSpec` optional field; update Create/Update inputs.
- [src/services/scheduler.service.ts](src/services/scheduler.service.ts) — add `run` branch using RunExecutor.
- [src/services/run-executor.service.ts](src/services/run-executor.service.ts) — new service.
- [src/services/docker.service.ts](src/services/docker.service.ts) — add `composeRun` or `dockerRun` helpers if missing.
- [src/services/schedule.service.ts](src/services/schedule.service.ts) — validate schedule payloads and nextRun handling.
- [src/api/routes/app-schedules.route.ts](src/api/routes/app-schedules.route.ts) and [src/api/routes/schedules.route.ts](src/api/routes/schedules.route.ts) — accept/validate payload.runSpec and add `POST /schedules/:id/trigger`.
- [src/mcp/server.ts](src/mcp/server.ts) — reuse `trigger_schedule` tool.
- Tests under `test/` — new scheduler/run tests.

**Verification**
1. Unit tests: RunExecutor modes (mock docker/execa) and scheduler `run` branch.
2. Integration: create test app with runSpec, create schedule, enable `SCHEDULER_ENABLED=true`, and assert `schedule_runs` success/failure and expected behavior.
3. Manual: Use MCP `trigger_schedule` and new HTTP trigger to run schedules; inspect `schedule_runs` and logs.

**Decisions / rationale**
- Use per-app runSpec to avoid a new install type and minimize surface area changes.
- Scheduler uses app.runSpec by default and supports per-schedule override for flexibility.
- Disallow raw shell command mode for non-admins to reduce abuse risk.
- Persist run histories to `schedule_runs` for auditing and retries (reuse `retryPolicy` field).

**Further considerations**
1. Observability: emit metrics for schedule job duration and result; consider log aggregation or upload of full logs to a configured log store.
2. Resource controls: consider cgroups or container limits for heavy jobs (future work).
3. RBAC: define who can set runSpec.command or use command-mode in docs and API validation.

Next: I can implement the DB migration + TS `RunSpec` type and update the app types and API validation now. Which next step do you want me to take first?