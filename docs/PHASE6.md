# Phase 6 — Tests, Docs, Release

Purpose: complete Phase 6 by adding tests, documentation updates, changelog preparation, and packaging for release.

Quick steps
- Run unit & smoke tests: `npm test`
- Add concurrency integration test: create `test/concurrency.test.ts` that simulates parallel `bin/deployer` CLI calls against a running server and asserts `request_logs` writes are consistent.
- Update docs: add CLI usage notes to `README.md` or `docs/CLI.md` and include `--token`/env usage, `--wait`, and `--follow` examples.
- Prepare changelog: update `CHANGELOG.md` with Phase 5/6 entries and bump package version.
- Dry-run publish: `npm pack` (validate package contents) then `npm publish --tag beta` or normal publish when ready.

Running tests locally

```bash
npm install
npm test
```

If tests hang due to integration tests that spawn services, run only unit tests first:

```bash
npx vitest run test/phase6.smoke.test.ts
```

Notes
- The project uses Vitest. Existing tests live under `test/`.
- Phase 6 should include an integration test that asserts `request_logs` receives entries under high concurrency; consider using a worker queue or `runExclusive` behavior in tests.
