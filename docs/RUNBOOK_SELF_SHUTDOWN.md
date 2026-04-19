# Self-shutdown Runbook

Prerequisites:
- `DEPLOYER_ADMIN_TOKEN` must be set and known to operator
- `ALLOW_SELF_SHUTDOWN` must be set to `true` in environment
- For destructive delete mode, `ALLOW_SELF_SHUTDOWN_DELETE` must be `true`

Dry-run:
1. Call POST /admin/self-shutdown with `{ "dryRun": true }` and admin bearer token.
2. Review returned plan of affected apps. No changes are made.

Execution (safe):
1. Generate a short confirm token (min 8 chars).
2. Call POST /admin/self-shutdown with `{ "dryRun": false, "confirmToken": "<token>", "deleteInstalled": false }` and admin token.
3. Monitor audit logs at `shutdown_logs` table and `/mcp` tools.

Recovery:
- If files were deleted, recovery requires restoring backups or re-cloning repos and re-registering apps.
- Use `self_register` and `self_update` to bring deployer back online if needed.

Notes:
- Self-shutdown is destructive; enable behind feature flag and only grant admin access to authorized operators.
