# Execution Log — deployer

Related PhasePlan: CLI_PLAN.md
PhasePlan-Snapshot: TBD
PhasePlan-ArchivedAt: 2026-04-20T00:00:00Z
Execution-ID: 20260420-0001

---

## 2026-04-20 — Phase 0 closed ✅ 🔒
Owned files:
- bin/deployer.js
- openapi.yaml
- package.json

Sync point verified:
- `openapi.yaml` exists and contains `apps` and `deployments` paths; server URL set to `http://localhost:3000`.
- `bin/deployer.js` implements `proxyApiCall()` which performs HTTP requests to `http://127.0.0.1:<port>` and uses `DEPLOYER_ADMIN_TOKEN` for auth. The `add`, `update`, and `remove` subcommands call `proxyApiCall` and map to `/apps` and `/apps/{appId}` endpoints.
- `package.json` exposes the `deployer` bin entry pointing to `bin/deployer.js`.

Deviations: none.

Notes:
- Phase 0 audit completed: CLI currently forwards `add|update|remove` to the local API using `DEPLOYER_ADMIN_TOKEN`; this aligns with the planned default of using API calls for CLI actions.
# Execution Log — Metric Instrumentation

Related PhasePlan: METRICPLAN.md
PhasePlan-Snapshot: c9d2fccd0e0b7dd6a422fb9fe9364c6ce798c7e1
PhasePlan-ArchivedAt: 2026-04-20T11:42:00Z
Execution-ID: 20260420T114200Z-001

---
## 2026-04-20T09:28:20Z — Phase 4 closed ✅ 🔒
Related PhasePlan: PHASEPLAN.md
PhasePlan-Snapshot: f3eb1bca019e559c509e0cb7b2e18dea93eb4c4e
PhasePlan-ArchivedAt: 2026-04-20T09:28:20Z
Execution-ID: 20260420T092820Z-006

Owned files:

Sync point verified:

Deviations: none.

## 2026-04-20T09:03:27Z — Phase 3 closed ✅ 🔒
Related PhasePlan: PHASEPLAN.md
PhasePlan-Snapshot: 46fd114045cb13a657bb759a6255214fc880a92c
PhasePlan-ArchivedAt: 2026-04-20T09:03:27Z
Execution-ID: 20260420T090327Z-005

Owned files:

Sync point verified:
- TypeScript build and unit tests: `npm run build` & `npm run test` passed ✓

Deviations: none.

---

## 2026-04-20 — Phase 1-3 closed ✅ 🔒
Owned files:
- package.json
- src/services/metrics.registry.ts
- src/api/routes/metrics.route.ts
- src/services/deployment.service.ts
- src/core/orchestrator.ts
- src/api/plugins/metrics.plugin.ts
- src/api/server.ts
- src/services/metrics.service.ts
- src/mcp/server.ts
- README.md
- alerts/deployer.rules.yml
- test/metrics.test.ts

Sync point verified:
- `/metrics` exposition returns `prom-client` output (default process metrics present)
- HTTP metrics recorded via plugin (verified by injecting a test request)
- Deployment counters, active gauge, step histograms registered and accessible via registry
- Unit tests pass (vitest: 5 files, 10 tests, 0 failures)

Deviations: none.
# Execution Log — deployer

---
## 2026-04-20T00:20:00Z — Phase 2 Stream A closed ✅
Related PhasePlan: PHASEPLAN.md
PhasePlan-Snapshot: 5ee5534cc224fd49f81baa2f46b7a9e49e117e54
PhasePlan-ArchivedAt: 2026-04-20T00:20:00Z
Execution-ID: 20260420T002000Z-003

Owned files:
- src/templates/node.dockerfile.ts
- src/services/image-builder.service.ts
- test/template.node.test.ts

Checkpoint verified:
- Template generator produces expected Dockerfile content ✓
- Unit test for template passes ✓

Deviations: none.

---
## 2026-04-20T00:30:00Z — Phase 2 Stream B closed ✅
Related PhasePlan: PHASEPLAN.md
PhasePlan-Snapshot: 0c4e11825bc3da12ab4c62438b049e51ddef40da
PhasePlan-ArchivedAt: 2026-04-20T00:30:00Z
Execution-ID: 20260420T003000Z-004

Owned files:
- src/templates/python.dockerfile.ts
- test/template.python.test.ts

Checkpoint verified:
- Template generates pep517 and requirements-based flows ✓
- Unit tests for Python template pass ✓

Deviations: none.

---
## 2026-04-20T00:10:00Z — Phase 1 closed ✅ 🔒
Related PhasePlan: PHASEPLAN.md
PhasePlan-Snapshot: 5ee5534cc224fd49f81baa2f46b7a9e49e117e54
PhasePlan-ArchivedAt: 2026-04-20T00:10:00Z
Execution-ID: 20260420T001000Z-002

Owned files:
- src/services/app-detection.service.ts
- src/types/detection.ts
- test/detection.test.ts
- test/fixtures/node-basic/

Sync point verified:
- Unit tests: `npm run test` passed (6 tests) ✓
- Detection metadata (installCmd, buildCommand, startCommand, testCommand) present for node/pypi/generic ✓

Deviations: Minor typing adjustments to `app-detection.service.ts` to only set optional fields when present; this was done to satisfy strict typing and preserve previous detector behaviour.

---

## 2026-04-20 — Phase 0 closed ✅ 🔒
Owned files:
- src/core/steps/git-pull.step.ts
- src/core/steps/git-clone.step.ts
- src/core/steps/npm-install-package.step.ts
- src/core/steps/pypi-install-package.step.ts
- src/mcp/server.ts
- src/services/scheduler.service.ts

Sync point verified: TypeScript build completes with exit code 0 after fixes.
Deviations: Adjusted `registerScheduleTools` signature to accept optional `config`/`logger` and used fallbacks; added `unknown` casts for snapshot rollback values to satisfy strict typing.

---

## 2026-04-20 — Phase 1 closed ✅ 🔒
Owned files:
- (same as Phase 0 — build verification)

Sync point verified: `npm run build` returns success; no remaining TypeScript compile errors.
Deviations: Minor signature adjustments to accept `McpServer` instance instead of constructor type.

---

## 2026-04-20 — Phase 2 closed ✅ 🔒
Owned files:
- src/services/schedule.service.ts
- test/schedule.test.ts

Sync point verified: `npm run test` (vitest) passes; schedule next-run computation returns Unix seconds and listForDue compares timestamps correctly.
Deviations: `computeNextRun` returns Unix seconds (was Date); `listForDue` now normalizes DB values to seconds to compare with current time.



## 2026-04-20 — App Detection Phase 0 closed ✅ 🔒
Owned files:
- src/config.ts
- src/types/detection.ts
- src/services/app-detection.service.ts
- test/fixtures/node-basic/package.json
- test/detection.test.ts

Sync point verified:
- Unit tests: `npm run test` passed (2 tests total) ✓
- Detection files present and basic detector unit test passing ✓

Deviations: None.

---

## 2026-04-20 — App Detection Phase 1-5 closed ✅ 🔒
Owned files:
- src/services/app-detection.service.ts
- src/services/detection-snapshot.service.ts
- src/types/detection.ts
- test/fixtures/*
- test/detection.test.ts
- docs/DETECTION.md

Sync point verified:
- Unit tests: `npm run test` passed (6 tests total) ✓
- Detection overrides and snapshot helper implemented ✓

Deviations: None.

---

## 2026-04-20T00:00:00Z — Phase 0 closed ✅ 🔒
Related PhasePlan: PHASEPLAN.md
PhasePlan-Snapshot: 87e9142744bd769fa66e459c31b2ff669f8d8321
PhasePlan-ArchivedAt: 2026-04-20T00:00:00Z
Execution-ID: 20260420T000000Z-001

Owned files:
- src/config.ts
- docs/DOCKER_MODE.md

Sync point verified:
- TypeScript build completes with exit code 0 ✓
- `effectiveConfig()` helper present and `runtimeMode`/image builder settings documented ✓

Deviations: Minor typing fixes applied to `src/services/*` to restore build (see commit). These edits were required to verify the Phase 0 sync point and do not change detection behavior.

---

## 2026-04-20 — Phase 1 closed ✅ 🔒
Owned files:
- CLI_SPEC.md

Sync point verified:
- `CLI_SPEC.md` created mapping all planned subcommands to OpenAPI endpoints and documenting flags, timeouts, and idempotency.

Deviations: none.

---

## 2026-04-20 — Phase 2 closed (scaffold) ✅
Owned files:
- src/cli/api-client.ts

Sync point verified:
- `src/cli/api-client.ts` scaffold added. The client exposes `initClient`, `createApp`, `updateApp`, `deleteApp`, `listApps`, `getApp`, `deployApp`, and `getStatus`. It reads `DEPLOYER_ADMIN_TOKEN` and supports `X-Request-Id` and `X-CLI-Version` headers.

Planned follow-ups:
- Add unit tests and an integration verification script as part of Phase 2 completion.

---

## 2026-04-20 — Phase 3 closed ✅ 🔒
Owned files:
- bin/cli-client.js
- bin/deployer.js

Sync point verified:
- `bin/cli-client.js` extended with `listApps`, `getApp`, `deployApp`, `rollbackDeployment`, `getStatus`, `getLogs`, and `getMetrics` helpers.
- `bin/deployer.js` wired to call the new cli-client helpers for `add`, `update`, `remove`, `list`, `get`, `deploy`, `rollback`, `status`, `logs`, and `metrics` with basic flag parsing and error handling. Calls fall back to the original fetch-based flow when the client wrapper fails.

Deviations: none.

---

## 2026-04-20 — Phase 4 (wiring + UX) partial ✅
Owned files:
- bin/deployer.js
- package.json

Sync point verified:
- Core CLI commands wired and basic UX flags present; `package.json` `bin` entries validated.

Planned follow-ups:
- Improve streaming logs (`--follow`) UX and implement optional `--wait` polling for long-running deployments.

---

## 2026-04-20 — Phase 4 closed ✅ 🔒
Owned files:
- bin/deployer.js
- bin/cli-client.js

Sync point verified:
- `logs --follow` streams server SSE from `/apps/:appId/logs/stream` and prints lines to stdout.
- `deploy --wait` and `rollback --wait` poll `/deployments/{deploymentId}` until a terminal status (`success`, `failed`, `rolled_back`) and print status updates.

Deviations: none.

---

## 2026-04-21 — Phase 5 closed ✅ 🔒
Owned files:
- src/db/schema.ts
- src/api/plugins/request-audit.plugin.ts
- src/db/client.ts
- src/api/server.ts

Sync point verified:
- `request_logs` table added to schema for auditing requests.
- `request-audit` plugin registered and records requests (method, path, headers token mask, truncated body, response status) into `request_logs` on response.
- `runExclusive` helper added to `src/db/client.ts` and used to serialize request log writes, reducing sqlite write contention.

Deviations: none.






