# Phase Plan: Implement OpenAPI-driven CLI in npx @jsilvanus/deployer

## Overview
This plan implements a full CLI (`npx @jsilvanus/deployer`) driven by the repository's OpenAPI spec; all API-related operations will use HTTP API calls to the running deployer server so server-side sqlite and logging remain authoritative. There are 6 development phases plus testing/docs/release. The critical path runs: audit → CLI spec → API client → replace function calls → CLI wiring.

## Dependency Map
Audit → CLI spec → API client → Replace function calls → CLI wiring → Logging/audit → Tests/docs

---

## Phase 0: Audit & Foundation ✅ 🔒
**Mode:** Sequential
**Depends on:** none
**Goal:** Clear mapping from CLI commands → OpenAPI endpoints and list of existing partials to preserve.

### Sequential steps
1. Inventory existing CLI code and partial implementations (start with `bin/deployer.js` and CLI helpers) — find where `add`/`remove`/`update` are function calls. - [x]
2. Validate `openapi.yaml` covers required endpoints; note missing or mismatched schemas. - [x]
3. Document auth expectations (admin token vs per-app key) and default host/port used by the CLI. - [x]
4. Create a minimal decision doc: "All CLI commands call HTTP API except `deployer server`." - [x]

**Sync point:** Audit doc mapping CLI actions → API endpoints completed.

---

## Phase 1: CLI Command Spec & UX
**Mode:** Sequential
**Depends on:** Phase 0
**Goal:** Final CLI subcommand surface and argument/flag mapping to OpenAPI endpoints.

### Sequential steps
1. Draft CLI subcommands (`add`, `remove`, `update`, `list`, `get`, `deploy`, `rollback`, `logs`, `metrics`, `setup`, `server`) and flags (`--host`, `--port`, `--token`, `--dry-run`, `--wait`). - [x]
2. Map each subcommand to one OpenAPI operation (HTTP method + path + payload). Document expected exit codes and user-facing messages. - [x]
3. Specify retry/timeout defaults and behaviour for interactive vs non-interactive modes. - [x]
4. Ensure `package.json` `bin` metadata supports `npx @jsilvanus/deployer`. - [x]

**Sync point:** CLI spec doc (command → OpenAPI mapping) complete.

## Phase 2: API Client Wrapper ✅ 🔒
**Mode:** Sequential
**Depends on:** Phase 1
**Goal:** Add a single reusable HTTP client used by CLI code to call the server and centralize logging, retries, auth, and response handling.

### Sequential steps
1. Implement `src/cli/api-client.ts` (or `src/cli/client.ts`) exporting typed methods for each OpenAPI operation used by the CLI. - [x]
2. Ensure the client:
   - Reads host/port/token from CLI flags, env vars, or config file.
   - Sends requests with structured metadata for server-side logging (`X-Request-Id`, `cli-version`).
   - Implements idempotency headers where appropriate.
   - Handles errors and translates them to friendly exit codes.
   - (basic support implemented in scaffold) - [x]
3. Add unit tests for the client (mock server).
4. Add a small integration script to verify calls against a running local server.

**Sync point:** API client passes unit tests and example integration call succeeds.

---

## Phase 2: API Client Wrapper
**Mode:** Sequential
**Depends on:** Phase 1
**Goal:** Add a single reusable HTTP client used by CLI code to call the server and centralize logging, retries, auth, and response handling.

### Sequential steps
1. Implement `src/cli/api-client.ts` (or `src/cli/client.ts`) exporting typed methods for each OpenAPI operation used by the CLI.
2. Ensure the client:
   - Reads host/port/token from CLI flags, env vars, or config file.
   - Sends requests with structured metadata for server-side logging (`X-Request-Id`, `cli-version`).
   - Implements idempotency headers where appropriate.
   - Handles errors and translates them to friendly exit codes.
3. Add unit tests for the client (mock server).
4. Add a small integration script to verify calls against a running local server.

**Sync point:** API client passes unit tests and example integration call succeeds.

---

## Phase 3: Replace Internal Function Calls with API Calls
**Mode:** Sequential
**Depends on:** Phase 2
**Goal:** Ensure all CLI-facing operations use the HTTP client rather than local function calls, leaving `deployer server` unchanged.

### Sequential steps
1. Identify all code paths where CLI or MCP tools call internal functions directly for app/deployment actions. - [x]
2. Replace those call sites to use the API client (preserve local helpers that format payloads). - [x]
3. For code shared by CLI and internal services, keep shared utility logic but route actions through HTTP when invoked from the CLI. - [x]
4. Add compatibility shims where necessary to accept both local-call and API-call modes during transition, but default CLI → API. - [x]

**Sync point:** End-to-end commands (add, update, remove, list, get, deploy, rollback, status, logs, metrics) now route CLI → API server → DB, with fallback to original behavior if client errors occur.

**Phase 3 status:** ✅ 🔒

---

## Phase 4: Full CLI Wiring and UX polish ✅
**Mode:** Sequential | Parallel (up to 3 streams)
**Depends on:** Phase 3
**Goal:** Finalize CLI UX: robust argument parsing, `--token`/`--config` support, improve output formatting, and verify `npx` usage.

### Parallel streams (run simultaneously)
**Stream A — Core commands**
- Finalize flags parsing for `add`, `remove`, `update`, `list`, `get` and add `--token`/`--config` handling. - [x]

**Stream B — Deployment flows**
- Improve `deploy`, `rollback`, `status`, `logs`, `metrics` UX: add `--wait`, `--follow`, and streaming where supported. - [x]

**Stream C — Packaging & npx**
- Ensure `package.json` `bin` entry points to `bin/deployer.js` and `npx` invocation behaves correctly across platforms. - [x]

**Sync point:** All CLI commands usable via `npx` and deliver consistent server-side results.

---

## Phase 5: Logging, Audit, and SQLite write-safety
**Mode:** Sequential
**Depends on:** Phase 4
**Goal:** Ensure CLI requests are logged/audited server-side and sqlite single-write concerns are respected.

### Sequential steps
1. Ensure client sends `X-Request-Id` and `cli-version` headers on every request.
2. On server, add/verify request-audit middleware to log action, caller token, timestamp, and request body (to `deployment_snapshots`/deployment logs).
3. Implement or verify server-side concurrency safeguards for sqlite writes (queuing, single-writer mutex, or serialized transactions).
4. Add integration tests simulating concurrent CLI requests to confirm sqlite remains consistent.

**Sync point:** Audit records appear in DB for CLI calls and concurrent writes are safe.

---

## Phase 6: Tests, Docs, and Release
**Mode:** Parallel (2 streams)
**Depends on:** Phase 5
**Goal:** Comprehensive tests, user docs, and publish-ready package.

### Parallel streams
**Stream A — Tests**
- Add unit tests for CLI parsing and API client.
- Add integration tests that run a local server process and exercise common commands (`add`, `update`, `deploy`, `rollback`, `logs`).
- (Remove CI job requirement) Add integration tests that run locally or in the project's preferred CI later.

**Stream B — Docs & release**
- Update README with `npx @jsilvanus/deployer` usage examples and auth instructions.
- Update `openapi.yaml` docs where necessary and generate CLI help from the CLI spec if desired.
- Bump version, prepare changelog, and publish to npm (or provide release instructions).

**Sync point:** Tests pass locally or in your chosen CI and README shows examples; package ready to publish.

---

## Critical Path
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4

## Risk Register
- OpenAPI mismatches: If `openapi.yaml` doesn't cover endpoints or schemas, CLI mapping will break. Mitigation: fix spec first in Phase 0/1.
- Auth/permission gaps: CLI must correctly present admin token vs per-app keys. Mitigation: test both flows early and document fallback.
- sqlite concurrency: multiple concurrent CLI calls may conflict. Mitigation: enforce server-side single-writer pattern and test with concurrent integration tests.
- npx packaging surprises (Windows shebangs, EOLs): Mitigation: test on Windows CI or local Windows devbox and use cross-platform scripts.
- Partial-impl regressions: Replacing function calls could inadvertently change behavior. Mitigation: compatibility shims and thorough integration tests.

## Recommended Starting Point
Start with Phase 0: run the audit—search for CLI handlers and the current partial implementations (begin with `bin/deployer.js` and any CLI helper files), and map them to `openapi.yaml`. This will reveal the exact gaps to cover and let you finalize the CLI command spec (Phase 1).
