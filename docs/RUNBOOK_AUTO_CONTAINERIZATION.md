---
# RUNBOOK — Auto-Containerization (Operator Guide)

Purpose
This document guides operators through a safe rollout of auto-containerization features, including preflight checks, exact commands for rollout and rollback, monitoring targets, emergency procedures, and maintenance-window guidance.

Prerequisites (host)
- Node.js (16+/18+), npm
- git
- docker & docker compose (if deploying containers)
- systemd or pm2 depending on host setup
- Required env vars set: `DEPLOYER_ADMIN_TOKEN`, `DEPLOYER_ENV_ENCRYPTION_KEY` (64 hex chars)

Preflight checks
- Run `sh scripts/runbook-auto-containerization-checks.sh` (non-destructive) or manually verify tool availability, env vars, and run `npm run test`.

Rollout procedure (step-by-step)
1. Announce maintenance window and notify stakeholders.
2. Snapshot DB: `cp "$DEPLOYER_DB_PATH" "${DEPLOYER_DB_PATH}.$(date -u +%Y%m%dT%H%M%SZ).bak"`.
3. Checkout release branch/tag and `npm ci`.
4. Build and postbuild (`npm run build && npm run postbuild`).
5. Run migrations (`npm run db:migrate`) after snapshot.
6. Restart service (systemd/pm2/docker) and run smoke checks: `/health`, `/version`, `/metrics`.

Rollback checklist
- Stop incoming traffic, restore DB snapshot, checkout previous tag, rebuild, and restart. Verify health endpoints.

Emergency procedures
- If service fails repeatedly: revert to previous tag and restore DB backup. If key compromise is suspected: rotate `DEPLOYER_ENV_ENCRYPTION_KEY` and revoke tokens.

Maintenance windows guidance
- Recommended window: 60–120 minutes. Notify stakeholders 24h and 1h prior for production-impacting changes.

Appendix — quick commands
- Health check: `curl -fsS http://localhost:3000/health && echo OK`
- Create DB snapshot:
  - `DBPATH=${DEPLOYER_DB_PATH:-./deployer.db}`
  - `cp "$DBPATH" "${DBPATH}.$(date -u +%Y%m%dT%H%M%SZ).bak"`

---
