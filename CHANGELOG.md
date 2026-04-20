# Changelog

## 2026-04-20 — Metric instrumentation
- Added Prometheus integration and `prom-client` registry
- Exposed `/metrics` Prometheus endpoint (admin-only)
- Instrumented deployments: totals, active gauge, failures, durations
- Added step-level timing and failure counters
- Added HTTP request counters and durations
- Instrumented MCP tools with metrics
- Published sampled app CPU/memory/status from poller
- Added example Alertmanager rules and unit tests

Next steps / TODOs:
- Consider bucket tuning for histograms in production
- Add integration tests for orchestrator metrics increment behavior

# Changelog — deployer

Project: deployer

Generated from PHASEPLAN2.md and EXECUTION_LOG.md on 2026-04-20T00:00:00Z

## Summary (one-line per phase with edited-files and optional commit)

### Plan: App Detection (PHASEPLAN2.md)

- Phase 0 — Foundation: added feature flags, config entries, `DetectionResult` type, and initial detection service.
	- Edited files: src/config.ts, src/types/detection.ts, src/services/app-detection.service.ts
	- Commit: 2315232f72362b4a14ed57a2fcdc830ef87e326c

- Phase 1 — Detector Implementations: implemented Node, Python, generic-Python detectors and added test fixtures.
	- Edited files: test/fixtures/, test/detection.test.ts
	- Commit: 2315232f72362b4a14ed57a2fcdc830ef87e326c

- Phase 2 — Merge Logic, Precedence & Overrides: deterministic merge strategy and override hooks implemented.
	- Edited files: src/core/, src/services/ (merge/precedence related files)
	- Commit: 94f8712de7bf99c5269a4fe6eb0ff3e0f4cca0bf

- Phase 3 — Consumer Integration & Snapshotting: exposed detection API and added detection-snapshot helper.
	- Edited files: src/services/detection-snapshot.*
	- Commit: 94f8712de7bf99c5269a4fe6eb0ff3e0f4cca0bf

- Phase 4 — Tests: added unit tests and fixtures for detection cases.
	- Edited files: test/
	- Commit: 190f1a2435e2d030237a5e715358c6d2c918395f

- Phase 5 — Documentation & Rollout: published detection rules and operator docs.
	- Edited files: docs/DETECTION.md
	- Commit: N/A

---
Generated-by: phase-completion (user-invoked)
