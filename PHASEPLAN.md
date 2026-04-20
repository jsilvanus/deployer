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

1. Implement detectors:
	- Node: presence of `package.json`, `start`/`main`/`scripts` (sequential because templates depend on detector output)
	- Python (pypi/package): `pyproject.toml`, `setup.py`, `requirements.txt`
	- Generic python app: `app.py`, `wsgi.py`, `gunicorn` hints
2. Capture metadata: build steps, install commands, test commands, ports, env file expectations
3. Add unit tests for detection logic using representative repo fixtures

## Phase 1: App Detection & Heuristics ✅ 🔒
- [x] Implement detectors (node, python-pypi, python, docker, compose)
- [x] Capture metadata: build/install/test commands, ports, env files
- [x] Add unit tests using fixtures (node-basic, python-pypi, python-generic)

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
- Dockerfile that creates a venv, installs via `pip install .` or `pip install -r requirements.txt`, supports `gunicorn`/`uvicorn` entrypoints
- Handle `pyproject.toml` builds (PEP 517) and editable installs for dev

**Stream C — Common helper scripts**
- Image build wrapper, labels for Deployer metadata, healthcheck template, and image tag conventions

**Sync point:** Templates reviewed and unit-tested against sample repos

---

## Phase 3: Compose Generation & Runtime Integration
**Mode:** Sequential then Parallel (2 streams)
**Depends on:** Phase 2
**Goal:** Generate `docker-compose.yml` per-app and integrate runtime options (networks, volumes, traefik labels)

Sequential steps:
1. Design compose service schema that Deployer will write (env file mounting, secrets, restart policy)
2. Implement `compose-write` step extension to accept auto-generated compose content

Parallel streams:
**Stream A — Networking & routing**
- Generate Traefik labels when domain provided
- Create internal network options for cross-service comms

**Stream B — Persistent storage & env handling**
- Manage `.env` backups and encrypted env injection into Compose
- Volume mappings for logs and persistent data

**Sync point:** Compose files generated and `docker compose up` reproduces expected runtime locally for sample apps

---

## Phase 4: Orchestrator Hooks & Deployment Flows
**Mode:** Sequential
**Depends on:** Phase 3
**Goal:** Wire auto-containerization into Deployer plans and MCP tools

1. Add a `deploy-auto-container` plan that uses `git-clone` → detect → write Dockerfile/compose → `docker-compose-up`
2. Add feature-flagged branching in `update-*` plans to prefer compose when `dockerMode` is active
3. Ensure snapshots and rollback work with generated resources (compose files, images)

---

## Phase 5: Testing, CI, and Safety
**Mode:** Parallel (2 streams)
**Depends on:** Phase 4
**Goal:** End-to-end tests, security checks, and rollback verification

**Stream A — Integration tests**
- Use small sample repos to run full deploy flow in a CI job (build image, compose up, healthcheck)
- Test rollback path: simulate failing step and verify rollback cleans generated files & images

**Stream B — Security & hardening**
- Scan generated images for vulnerabilities, lint Dockerfile best-practices
- Enforce resource limits, restart policies, and avoid privileged containers

**Sync point:** CI jobs green and rollback verified

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
Phase 0 → Phase 1 (detection) → Phase 2 (templates) → Phase 3 (compose generation) → Phase 4 (orchestrator hooks) → Phase 5 (integration tests)

## Risk Register
- Detection false-positives/negatives → Mitigation: conservative defaults and opt-out flag; require explicit override in ambiguous cases.
- Generated Dockerfiles insufficient for complex apps (native deps, custom build steps) → Mitigation: provide `deployer.dockerfile` override and documented extension points.
- Rollback gaps (leftover images/volumes) → Mitigation: include cleanup steps in rollback, and test with failure simulations.
- CI flakiness on resource-limited runners → Mitigation: use lightweight sample apps for CI and provide an optional `--local` test mode.
## Recommended Starting Point
Implement Phase 0 and Phase 1 first: add Docker-mode config and robust detection logic (with unit tests). Detection output drives every subsequent step, so validating it early fails fast and keeps template work focused.

---

File: [PHASEPLAN.md](PHASEPLAN.md)
