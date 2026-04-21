# Phase Risks & Notices

Extracted from PHASEPLAN.md and EXECUTION_LOG.md — open items and mitigations.

- Detection false-positives/negatives
  - Status: Open
  - Phase: Phase 1
  - Mitigation: conservative defaults, opt-out flag, and require explicit override in ambiguous cases.
  - Owner: maintainers

- Generated Dockerfiles insufficient for complex apps (native deps, custom build steps)
  - Status: Open
  - Phase: Phase 2
  - Mitigation: provide `deployer.dockerfile` override and documented extension points.
  - Owner: maintainers

- Rollback gaps (leftover images/volumes)
  - Status: Open
  - Phase: Phase 3
  - Mitigation: include cleanup steps in rollback, and test with failure simulations.
  - Owner: maintainers

- CI flakiness on resource-limited runners
  - Status: Open
  - Phase: Phase 5
  - Mitigation: use lightweight sample apps for CI and provide an optional `--local` test mode.
  - Owner: maintainers

Notes:
- These entries were collated automatically from plan and execution artifacts. Review ownership and mitigation timelines before next release.
# Phase Risks — Metric Instrumentation

Source: METRICPLAN.md (2026-04-20)

- Risk: Duplicate metric registration on hot reload can throw
  - Phase: Foundation
  - Status: mitigated (registry module uses global cache and getOrCreate helpers)
  - Mitigation: Use centralized registry and getOrCreate; verify on hot reload

- Risk: Missing instrumentation points in custom steps
  - Phase: Implementation (Step-level)
  - Status: open
  - Mitigation: Centralize step timing in `DeploymentOrchestrator` loop; review custom steps for long-running IO

- Risk: DB-derived counters confuse dashboards (not true Prometheus counters)
  - Phase: Implementation (DB-derived gauges)
  - Status: open
  - Mitigation: Prefer incrementing `prom-client` counters where possible; document fallbacks in README

- Risk: Histogram bucket tuning may cause high memory/CPU
  - Phase: Implementation/Polish
  - Status: open
  - Mitigation: Select conservative buckets; monitor memory and adjust in production
# Phase Risks — App Detection

Generated from PHASEPLAN2.md and EXECUTION_LOG.md on 2026-04-20T00:00:00Z

## Extracted Risks

1. False detection leading to incorrect artifacts
   - Source: PHASEPLAN2.md — Risk Register
   - Status: Open
   - Mitigation: Conservative defaults; require explicit opt-in for `low` confidence; provide easy override mechanisms (`deployer.container.json`, `DEPLOYER_FORCE_CONTAINER_TYPE`). Monitor metrics in rollout.

2. Ambiguous repos (polyglot) producing conflicting hints
   - Source: PHASEPLAN2.md — Risk Register
   - Status: Open
   - Mitigation: Prefer explicit files (`Dockerfile`, `docker-compose.yml`) and surface detection rationale in deployment snapshots for operator review.

3. Rollback failure leaving images/volumes
   - Source: PHASEPLAN2.md — Risk Register
   - Status: Open
   - Mitigation: Add cleanup steps to rollback paths; include tests that simulate failing steps and assert cleanup.

## Notices / Deviations
- Execution log shows minor typing and signature adjustments during early phases; these were recorded as deviations and verified (see `EXECUTION_LOG.md`).

## Recommended Owners
- Detection metrics & rollout: owner: `platform` team (or repo maintainer)
- Rollback cleanup & tests: owner: `devops` or `platform`