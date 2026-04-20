# Changelog

- 2026-04-21: Phase 5 & 6 work — server-side request auditing and CLI -> API migration completed. Added request_logs table and request-audit plugin; added sqlite write serialization for audit writes. Added CLI docs and concurrency integration test.

## 2026-04-20 — Metric instrumentation

Next steps / TODOs:

# Changelog — deployer

Project: deployer

Generated from PHASEPLAN2.md and EXECUTION_LOG.md on 2026-04-20T00:00:00Z

## Summary (one-line per phase with edited-files and optional commit)

### Plan: App Detection (PHASEPLAN2.md)

	- Edited files: src/config.ts, src/types/detection.ts, src/services/app-detection.service.ts
	- Commit: 2315232f72362b4a14ed57a2fcdc830ef87e326c

	- Edited files: test/fixtures/, test/detection.test.ts
	- Commit: 2315232f72362b4a14ed57a2fcdc830ef87e326c

	- Edited files: src/core/, src/services/ (merge/precedence related files)
	- Commit: 94f8712de7bf99c5269a4fe6eb0ff3e0f4cca0bf

	- Edited files: src/services/detection-snapshot.*
	- Commit: 94f8712de7bf99c5269a4fe6eb0ff3e0f4cca0bf

	- Edited files: test/
	- Commit: 190f1a2435e2d030237a5e715358c6d2c918395f

	- Edited files: docs/DETECTION.md
	- Commit: N/A

Generated-by: phase-completion (user-invoked)
