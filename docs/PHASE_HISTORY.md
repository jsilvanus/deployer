## Plan snapshot — METRICPLAN.md (hash: c9d2fccd0e0b7dd6a422fb9fe9364c6ce798c7e1)
Date: 2026-04-20
Summary: Instrument Prometheus metrics across the deployer: deployment lifecycle, step-level timings, HTTP/MCP metrics, and DB-derived fallbacks.
Phases:
- Phase 1: Foundation — add `prom-client` registry and `/metrics` endpoint
- Phase 2: Implementation — deployment counters, step histograms, HTTP and MCP instrumentation
- Phase 3: Polish — docs, tests, and Alertmanager rules
# Plan snapshot — PHASEPLAN2.md (hash: a1c4fda8537378f195105557779eb194617a0674)
Date: 2026-04-20
Summary: App Detection Plan — implement repository inspection detectors (node, python, generic), merge logic, snapshotting, tests, and rollout docs.
Phases:
- Phase 0: Foundation — config, types, basic detection service
- Phase 1: Detector Implementations — node, python, generic, container detectors
- Phase 2: Merge Logic & Overrides — precedence rules and override mechanisms
- Phase 3: Integration & Snapshotting — wire detection into plans and store snapshots
- Phase 4: Tests — unit and basic integration tests
- Phase 5: Documentation & Rollout — operator docs and rollout plan
