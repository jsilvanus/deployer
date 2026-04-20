# Phase Plan: Auto-containerization for Deployer (Docker-mode)

## Overview
This plan defines the work to implement automatic containerization (Dockerfile + Compose) for `node/npm`, `python/pypi` and generic Python apps when Deployer runs in Docker-mode. 6 phases, a clear critical path, and parallel streams where safe. High-risk detection and runtime integration are scheduled early.

## Dependency Map
Config & environment → App detection → Container templates → Compose generation → Orchestrator hooks → Tests/docs

---

## Phase 0: Foundation (Config + env) ✅ 🔒
**Mode:** Sequential
**Depends on:** none
**Goal:** Docker-mode detection and feature flagging; runtime env and secrets design complete

- [x] Add `DEPLOYER_RUNTIME_MODE` detection + `dockerMode` flag — needed to gate auto-containerization
- [x] Document required host tools and default network conventions for Docker-mode
- [x] Add config entries for image builder options, base images, and build-time envs

---

## Phase 1: App Detection & Heuristics
**Mode:** Sequential
**Depends on:** Phase 0
**Goal:** Reliable detection of app types and entry points from a repo

NOTE: Detailed detection work has been split into `PHASEPLAN2.md` (Plan: App Detection).
Refer to `PHASEPLAN2.md` for full implementation details, fixtures, and test coverage.

Summary status:
- ✅ Implemented detectors (node, python-pypi, python, docker, compose)
- ✅ Captured metadata: build/install/test commands, ports, env files
- ✅ Unit tests and fixtures added (see `test/` and `PHASEPLAN2.md`)

---

## Phase 2: Container Template & Builders
**Mode:** Parallel (3 streams)
**Depends on:** Phase 1
**Goal:** Provide reusable Dockerfile templates and build/run helpers for each app type

**Stream A — Node/NPM Dockerfile**
**Stream A — Node/NPM Dockerfile** ✅
- [x] Multi-stage Dockerfile that runs `npm ci`/`npm install`, builds (if `npm run build` exists), and sets a minimal runtime image
- [x] Support optional `NODE_ENV`, build args, and package-lock handling

**Stream B — Python / PyPI Dockerfile**
**Stream B — Python / PyPI Dockerfile** ✅
- [x] Dockerfile that creates a venv, installs via `pip install .` or `pip install -r requirements.txt`, supports `gunicorn`/`uvicorn` entrypoints
- [x] Handle `pyproject.toml` builds (PEP 517) and editable installs for dev

**Stream C — Common helper scripts**
- [x] Image build wrapper, labels for Deployer metadata, healthcheck template, and image tag conventions

**Notes:** `src/services/image-builder.service.ts`, `src/templates/node.dockerfile.ts`, and `src/templates/python.dockerfile.ts` are implemented in the repository.

**Sync point:** Templates reviewed and unit-tested against sample repos

---

## Phase 3: Compose Generation & Runtime Integration
**Mode:** Sequential then Parallel (2 streams)
**Depends on:** Phase 2
**Goal:** Generate `docker-compose.yml` per-app and integrate runtime options (networks, volumes, traefik labels)

✅ 🔒 Phase 3 verified

Sequential steps:
1. Design compose service schema that Deployer will write (env file mounting, secrets, restart policy) — implemented
2. Implement `compose-write` step extension to accept auto-generated compose content — implemented (`src/core/steps/compose-write.step.ts`)

Parallel streams:
**Stream A — Networking & routing**
- Generate Traefik labels when domain provided — implemented (`src/core/steps/docker-compose-up.step.ts` uses Traefik overrides)
- Create internal network options for cross-service comms — implemented (internal network override + network creation)

**Stream B — Persistent storage & env handling**
- Manage `.env` backups and encrypted env injection into Compose — implemented via `AppEnvService` usage in compose/write flow
- Volume mappings for logs and persistent data — supported by generated compose content

**Sync point:** Compose files generation, overrides, and `docker compose up` integration are implemented and exercised by the compose steps

---

## Phase 4: Orchestrator Hooks & Deployment Flows
**Mode:** Sequential
**Depends on:** Phase 3
**Goal:** Wire auto-containerization into Deployer plans and MCP tools

1. Add plan wiring for container-based deployments — implemented via `deploy-docker`, `deploy-compose`, and `deploy-image` plans (`src/core/plans/*`).
2. Feature-flagged branching: supported via `runtimeMode`/`dockerMode` flags in `src/config.ts` and plan selection in routes/MCP (`src/api/routes/deployments.route.ts`, `src/mcp/server.ts`).
3. Snapshots and rollback for generated resources: implemented in compose/write + docker-compose-up steps (rollback uses `composeDown` and file snapshot).

**Notes:** There is no single `deploy-auto-container` plan in the repo; instead Deployer uses explicit per-type plans and runtime-mode gating to select the appropriate flow.

---

## Phase 6: Documentation & Rollout
**Mode:** Parallel (up to 3 streams)
**Depends on:** Phase 5
**Goal:** User docs, operator runbook, and gradual rollout plan

**Stream A — User docs**
- How to opt-in/out, env variables, customizing templates, and troubleshooting

**Stream B — Operator runbook**
- Rollout steps, monitoring, and migration from PM2 to Compose if needed

**Stream C — Migration utilities**
- Small helpers to convert existing app configs into compose-ready variants

**Sync point:** Documentation published, stakeholder review complete

---

## Critical Path
Phase 0 → Phase 1 (detection) → Phase 2 (templates) → Phase 3 (compose generation) → Phase 4 (orchestrator hooks)

## Remaining work (short)
- Finalize CI integration for container flows (image build + healthcheck) and add lightweight integration runs.
- Add image scanning and security checklist to release pipeline.
- Finish operator runbook: detailed rollback steps, metrics and monitoring to watch during rollout.
- Publish migration utilities and example override files (`deployer.dockerfile`) for complex apps.
- Polish docs: ensure examples and Traefik/compose overrides match runtime behavior.

## Risk Register
- Detection false-positives/negatives → Mitigation: conservative defaults and opt-out flag; require explicit override in ambiguous cases.
- Generated Dockerfiles insufficient for complex apps (native deps, custom build steps) → Mitigation: provide `deployer.dockerfile` override and documented extension points.
- Rollback gaps (leftover images/volumes) → Mitigation: include cleanup steps in rollback, and test with failure simulations.
- CI flakiness on resource-limited runners → Mitigation: use lightweight sample apps for CI and provide an optional `--local` test mode.
## Recommended Starting Point
Most infra and plan wiring are implemented. Start with Phase 5 (Testing, CI, and Safety) to validate end-to-end flows, exercise rollback paths, and run image scans; then finish Phase 6 (Documentation & Rollout).

---

File: [PHASEPLAN.md](PHASEPLAN.md)
