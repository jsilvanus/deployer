# Phase Plan: Metric Instrumentation for Deployer

## Overview
This plan covers adding comprehensive Prometheus instrumentation to the deployer codebase. It implements deployment lifecycle, step-level, HTTP, MCP, and DB/retention metrics. The plan has 3 phases (Foundation → Implementation → Polish), with step-level instrumentation being the critical path for observability. Goal: provide accurate counters/histograms (via prom-client) and minimal DB-derived fallbacks.

---

## Dependency Map
- Phase 1 (Foundation) must run before Phase 2 (Implementation) so the metrics register and exposition exist.
- Phase 2 Step-level instrumentation depends on the orchestrator wiring (Phase 1/2 overlap allowed for low-risk items).

---

## Phase 1: Foundation — add prom-client and exposer
**Mode:** Sequential
**Depends on:** none
**Goal:** Application exposes canonical Prometheus metrics using `prom-client` and a stable `/metrics` endpoint.

### Sequential steps
1. Add dependency: install `prom-client` and add to `package.json` (or note as dev/runtime dependency). This makes counters/histograms available.
2. Create a metrics module (e.g., `src/services/metrics.registry.ts`) that:
   - Imports `prom-client` and creates a shared `Registry`.
   - Registers common metrics (placeholders) and helper wrappers for creating counters, histograms, and gauges.
   - Exposes `async getMetricsText()` that returns `register.metrics()`.
   - Exposes a safe `getOrCreate...` API to avoid metric re-registration across hot reloads.
3. Update `src/api/routes/metrics.route.ts` to merge current text-format generator with `prom-client` output or, preferably, serve `prom-client` output as primary source. Keep legacy synthesized gauges (status/cpu/memory) but prefer emitting values into `prom-client` so counters/histograms are correct.
4. Add a small Fastify plugin to expose `/metrics` using `prom-client`'s registry and to secure it (admin token check). Register it in `src/api/server.ts`.

**Sync point:** `/metrics` endpoint returns `prom-client` metrics; test with `curl` and ensure admin auth enforced.

---

## Phase 2: Implementation — instrument the runtime
**Mode:** Parallel (up to 3 streams)
**Depends on:** Phase 1
**Goal:** Emit accurate counters, gauges, and histograms for deployments, steps, HTTP, MCP, and DB health.

Run these streams simultaneously (max 3):

**Stream A — Deployment lifecycle metrics (critical path)**
- Add metrics to `src/core/orchestrator.ts`:
  - `deployer_deployments_active` (gauge) — increment when `run()`/`rollbackDeployment()` sets status `running`, decrement when finished/rolled_back/failed.
  - `deployer_deployments_total{operation}` (counter) — increment in `DeploymentService.create()` for `deploy|update|rollback`.
  - `deployer_deployments_failed_total{operation}` (counter) — increment where orchestrator marks status `failed`.
  - `deployer_deployment_duration_seconds` (histogram) — observe on completion using `createdAt` → `finishedAt` or timers inside orchestrator.
- Ensure instrumentation covers both normal runs and rollbacks.

**Stream B — Step-level metrics**
- Add timing and failure counters around step execution in `DeploymentOrchestrator.run()`:
  - `deployer_step_duration_seconds{step,app}` (histogram) — measure execute() duration.
  - `deployer_step_failures_total{step,app}` (counter) — increment on exceptions.
- Optionally instrument `rollback` durations and failures similarly.
- For long-running/IO-heavy steps (npm-build, docker-build), ensure timers wrap the actual work.

**Stream C — API / MCP / DB metrics**
- Add HTTP metrics plugin (Fastify) that records:
  - `http_requests_total{method,route,status}` (counter)
  - `http_request_duration_seconds{method,route}` (histogram)
- Instrument MCP server endpoints in `src/mcp/server.ts` with `mcp_requests_total` and duration histogram.
- Add DB-derived gauges for retention/row counts (optional at first): e.g., `deployer_app_metrics_rows` (gauge) computed periodically or on scrape.

**Sync point:** Prometheus registry contains deployment counters, step histograms, HTTP metrics; verified by invoking endpoints and reading `/metrics`.

---

## Phase 3: Polish, docs, and alerting
**Mode:** Parallel (2 streams)
**Depends on:** Phase 2
**Goal:** Update docs, add tests, and provide example alerts.

**Stream A — Docs & OpenAPI**
- Update `README.md` to list new metrics and their labels.
- Add OpenAPI `components/schemas` references if desired for `/metrics` documentation.

**Stream B — Tests & Alerts**
- Add unit tests for metrics generation where feasible (e.g., orchestrator increments counters during a mocked run). Put tests under `test/metrics.*.test.ts`.
- Add an `alerts/` directory with example Alertmanager rules:
  - `deployer_deployments_active > 0` + `deployer_deployments_failed_total{job=...}` alerts.
  - `deployer_app_updating == 1` example rule.

**Sync point:** Tests pass; docs updated; example alert rules committed.

---

## Critical Path
Phase 1 → Phase 2 (Stream A: deployment lifecycle) → Phase 2 (Stream B: step-level) → Phase 3

Implementing the deployment counters and durations is the minimal chain required to get meaningful observability for deployments.

## Risk Register
- Adding `prom-client` changes metric semantics: duplicate metric registration on hot reload can throw. Mitigation: use registry `getSingleMetric` or check before creating metrics.
- Instrumentation points are easy to miss in custom step implementations. Mitigation: centralize timing in `DeploymentOrchestrator` loop rather than sprinkling in steps.
- Counters derived from DB (Option A) are not true Prometheus counters and can confuse dashboards. Prefer incremental `prom-client` counters (Option B).
- Increased memory/CPU from histogram buckets if configured with too many buckets. Mitigation: pick sensible buckets and reuse histograms where possible.

## Recommended Starting Point
Begin with Phase 1: add `prom-client` and a centralized `metrics.registry.ts` and wire `/metrics` to use it. Then implement deployment counters in `DeploymentOrchestrator` (Phase 2 Stream A). This yields immediate value (deployment counts/durations) and provides a template for instrumenting steps and HTTP.

---

## Implementation notes (practical tips)
- Use `prom-client`'s `Registry` and call `collectDefaultMetrics({ register })` for process metrics (optional).
- Avoid creating metrics in file-level code that can run multiple times; create them in a module that caches metric instances.
- For duration metrics, prefer `Histogram.startTimer()` which returns a function to observe elapsed seconds.
- Label cardinality: keep `app` label to app name but ensure names are stable and low-cardinality (avoid including dynamic IDs or paths).
- For `deployer_step_duration_seconds`, use `step` and `app` labels but not `deploymentId`.

---

## Quick TODO checklist (developer)
- [ ] Add `prom-client` dependency
- [ ] Create `src/services/metrics.registry.ts`
- [ ] Wire `/metrics` to `prom-client` output and keep legacy synthesizer if needed
- [ ] Instrument `DeploymentService.create()` to increment total counters
- [ ] Instrument `DeploymentOrchestrator` for active gauge and durations
- [ ] Add step timing and failure counters
- [ ] Add HTTP and MCP instrumentation plugin
- [ ] Update `README.md` and add tests



