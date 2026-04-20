# Phase Plan: App Detection Logic

## Overview
This plan covers building a robust app-detection service for Deployer that inspects a repository, determines app type (node, python/pypi, generic python, docker/compose), and emits a typed DetectionResult used by containerization and deployment plans. Five phases with unit and integration testing (locally) and safe override behavior. The critical path runs from config foundation → detectors → schema → integration testing.

## Dependency Map
Config → Detector implementations → Detection schema → Compose/Docker template consumers → Tests → Docs

---

## Phase 0: Foundation (Config + interfaces)
**Mode:** Sequential
**Depends on:** none
**Goal:** Define config flags and the `DetectionResult` TypeScript interface used everywhere

1. Add `dockerMode` / feature-flag config entries and opt-in default behavior  
2. Create `types/detection.ts` with `DetectionResult` (fields: `type`, `entrypoint`, `buildCommand`, `startCommand`, `ports`, `envFiles`, `installCmd`, `buildSystem`, `confidence`, `rawHints`)  
3. Add logging hooks to record detection rationale into deployment snapshots for auditability

**Status:** ✅ 🔒

Files completed:
- src/config.ts
- src/types/detection.ts
- src/services/app-detection.service.ts
- test/fixtures/node-basic/package.json
- test/detection.test.ts

---

## Phase 1: Detector Implementations
**Mode:** Parallel (up to 4 streams)
**Depends on:** Phase 0
**Goal:** Implement file- and metadata-based detectors that return `DetectionResult` fragments

**Stream A — Node/NPM detector**
- Detect `package.json`; read `scripts`, `main`, `bin`, `engines`; detect lockfile (`package-lock.json`, `yarn.lock`)
- Produce `installCmd`, `buildCommand`, `startCommand`, `ports` hints, and confidence

**Stream B — Python / PyPI detector**
- Detect `pyproject.toml`, `setup.py`, `requirements.txt`; parse `project`/`tool.poetry` tables
- Produce `buildSystem` (PEP517, poetry, pip), `installCmd`, entrypoint hints (`gunicorn`, `uvicorn`), and confidence

**Stream C — Generic Python detector**
- Detect `app.py`, `wsgi.py`, `manage.py`, common shebangs or `gunicorn` in requirements
- Emit run command hints and ports

**Stream D — Containerized repo detector**
- If `Dockerfile` or `docker-compose.yml` present, mark `type: docker/compose` and high confidence

**Sync point:** Merge detector outputs into a consolidated result; ensure deterministic precedence

**Status:** ✅ 🔒

Files completed:
- src/services/app-detection.service.ts
- test/fixtures/python-pypi/pyproject.toml
- test/fixtures/python-generic/app.py
- test/detection.test.ts (expanded)

---

## Phase 2: Merge Logic, Precedence & Overrides
**Mode:** Sequential
**Depends on:** Phase 1
**Goal:** Implement deterministic merging of multiple detector fragments and override mechanisms

1. Implement merge strategy: explicit files (`Dockerfile`/`compose`) win; otherwise highest-confidence detector wins
2. Add explicit override mechanisms: `deployer.container.json` file, env var `DEPLOYER_FORCE_CONTAINER_TYPE`, and deploy-time API/CLI overrides
3. Implement confidence thresholds and opt-in guard: if `confidence` is `low`, require explicit opt-in to auto-generate artifacts

**Status:** ✅ 🔒

Files completed:
- src/services/app-detection.service.ts (detectWithOverrides)

---

## Phase 3: Consumer Integration & Snapshotting
**Mode:** Parallel (2 streams)
**Depends on:** Phase 2
**Goal:** Wire detection output into the deploy plans and ensure safe snapshot/rollback

**Stream A — Plan integration**
- Expose detection API from `app-detection.service.ts` and update `deploy-auto-container` / `compose-write` consumers to accept `DetectionResult`

**Stream B — Snapshot & rollback**
- Store detection output in deployment snapshots; ensure rollback removes generated Dockerfiles/compose files and cleans images when appropriate

**Sync point:** Detection-driven plan runs in dry-run mode without writing files, and in write-mode produces artifacts tracked in snapshots

**Status:** ✅ 🔒

Files completed:
- src/services/detection-snapshot.service.ts

---

## Phase 4: Tests
**Mode:** Parallel (2 streams)
**Depends on:** Phase 3
**Goal:** Unit and integration tests validate detection accuracy and downstream compatibility (run locally or in your existing CI when ready)

**Stream A — Unit tests**
- Add fixtures under `test/fixtures/{node-basic, node-build, python-pypi, python-generic, docker-repo, ambiguous}`
- Unit tests asserting exact `DetectionResult` fields and confidence

**Stream B — Integration tests (local runs)**
- Use lightweight sample repos to run: `detect` → `generate artifact` → `docker build` (or simulate) → healthcheck where applicable
- Test rollback: simulate failing deploy step and assert cleanup

**Sync point:** Local test runs pass for detection unit tests and a minimal integration run

**Status:** ✅ 🔒

Files completed:
- test/fixtures/*
- test/detection.test.ts

---

## Phase 5: Documentation & Rollout
**Mode:** Parallel (2 streams)
**Depends on:** Phase 4
**Goal:** Operator docs, opt-in/out instructions, and migration notes

**Stream A — User docs**
- Document detection rules, override files/env vars, and how to customize generated Dockerfiles

**Stream B — Release plan**
- Gradual rollout: enable behind `dockerMode` feature flag; provide beta channel and metrics to track false-positives

**Sync point:** Docs published and rollout checklist approved

**Status:** ✅ 🔒

Files completed:
- docs/DETECTION.md

---

## Critical Path
Phase 0 → Phase 1 (detectors) → Phase 2 (merge/overrides) → Phase 3 (integration) → Phase 4 (tests)

## Risk Register
- False detection leading to incorrect artifacts → Mitigation: conservative defaults, explicit opt-in for low-confidence, easy overrides.
- Ambiguous repos (polyglot) → Mitigation: prefer explicit files, surface reasons in snapshot, require operator confirmation.
- Rollback failure leaving images/volumes → Mitigation: include cleanup steps, test rollback paths in CI.

## Recommended Starting Point
Implement `types/detection.ts` and the Node detector first (Phase 0 + Stream A of Phase 1). Node detection is high-value, fast to test, and will exercise the detection API used by other templates.

---

File: [PHASEPLAN2.md](PHASEPLAN2.md)
