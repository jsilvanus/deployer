---
# Auto-Containerization — User Guide

Purpose & scope
This guide documents auto-containerization features (generated Dockerfiles and compose), how app owners opt in/out, required environment variables, template customization, troubleshooting, short Node/Python examples, and a pointer to the operator runbook.

Opt-in / Opt-out (per-app)
- Opt-in per app: use your management surface (UI/CLI/MCP or REST API) and set the app’s config to enable the auto-containerization feature (for example, set `runtimeMode: 'docker'` or enable the `autoContainerize` flag on the app record).
- Opt-out: toggle the same flag off or set the app `type` to `node`/`python` (PM2) and redeploy.
- Notes: changes generally require a new deployment to apply.

Environment variables (runtime)
- DEPLOYER_ADMIN_TOKEN — Admin bearer token (required for management operations).
- DEPLOYER_ENV_ENCRYPTION_KEY — 64 hex chars (32 bytes) for AES-256-GCM; required for encrypted .env and app env storage.
- DEPLOYER_PORT — HTTP port (default 3000).
- DEPLOYER_ALLOWED_DEPLOY_PATHS — comma-separated allowed deploy roots (default /srv/apps).
- DEPLOYER_DB_PATH — path to the SQLite DB file (default ./deployer.db).
- LOG_LEVEL — pino logging level (info/warn/error/debug).
- NODE_ENV — production|development (affects pretty logging).

Template customization guide
- Templates live in `src/templates` (node.dockerfile.ts, python.dockerfile.ts). Copy and adapt them into your app repo when you need full control.
- Recommended flow:
  1. Copy template into app repo as `deployer.dockerfile` or `Dockerfile`.
  2. Adapt base image, build args, and platform-specific build steps.
  3. Avoid secrets in Dockerfile; use encrypted env vars or host mounts.

Troubleshooting (quick)
- Git clone failures: ensure `git` is installed and the deployer user can access the host network.
- Build failures: check builder logs for missing build tools or native dependency errors.
- Encryption errors: verify `DEPLOYER_ENV_ENCRYPTION_KEY` length and correctness.

Example usage snippets

Node (containerized)
- Ensure `npm run build` produces `dist/`. Use the provided sample Dockerfile in `examples/deployer.dockerfile.sample` as a base.

Python (containerized)
- Use the Python template in `src/templates/python.dockerfile.ts` or `examples/deployer.dockerfile.sample` adapted for Python.

Runbook pointer
- For operator procedures (preflight, rollout, rollback) see `docs/RUNBOOK_AUTO_CONTAINERIZATION.md`.

Change control & safety
- Plan rollouts during a maintenance window and snapshot `DEPLOYER_DB_PATH` before migrations or wide rollouts.

---
