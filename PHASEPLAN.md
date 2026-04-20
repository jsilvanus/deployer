# PHASEPLAN — Deployer Remediation

## Phase 0: Build Remediation ✅ 🔒
- [x] Align dependencies and run initial build
- [x] Fix Drizzle timestamp & query typing issues
- [x] Replace `fetch(..., timeout)` with AbortController pattern
- [x] Fix MCP server tool registration and typings
- [x] Ensure Git credentials `username` is a string
- [x] Make snapshot casts safe in npm/pypi steps
- [x] Guard scheduler lock release

## Phase 1: Build Verification ✅ 🔒
- [x] Run `npm run build` and resolve TypeScript errors
- [x] Confirm build completes with exit code 0

## Phase 2: Tests 🔄
- [x] Run `npm run test` and fix failing tests until green

---
Tests: vitest suite passing locally (1 test).

---
Notes:
- Next: run tests, fix any failures, then commit and push changes to `origin/main`.
