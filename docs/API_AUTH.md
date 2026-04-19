# API Authorization Model

This document summarizes the authorization model used by the Deployer API and the required scope for new endpoints added in the PHASEPLAN.

Principles
- **Admin token (`DEPLOYER_ADMIN_TOKEN`)**: powerful bearer used for cluster-level and destructive actions (create/delete apps, self-shutdown with delete, global migrations, CDN/provider purges). This token should be kept offline and rotated periodically.
- **App-scoped API key (`X-APP-KEY`)**: per-app secret returned once at app creation. Scoped to a single `appId` and limited to non-global operations for that app: version checks, start/stop/restart, per-app schedule CRUD, per-app cache purge. App keys MUST NOT be able to perform destructive cluster-wide operations.

Per-path recommendations
- `GET /apps/{appId}/version` — App key or admin token allowed.
- `GET /apps/{appId}/version/latest` — App key or admin token allowed.
- `GET /apps/{appId}/versions` — Admin token preferred for history; app key allowed if app owner needs viewing rights.
- `POST /apps/{appId}/registry/test` — App key or admin token allowed; testing is transient and does NOT persist credentials.
- `PATCH /apps/{appId}` (persistCredentials=true) — Admin token required if `ALLOW_PERSIST_REGISTRY_CREDENTIALS=false` in config; otherwise app key may persist if feature flag enabled. Persisted credentials are encrypted at rest and never returned in full.
- `POST /apps/{appId}/shutdown` — App key allowed for non-destructive actions (`stop`, `restart`, `graceful`); admin token required for destructive (`destroy`) or when `ALLOW_SELF_SHUTDOWN` gating requires admin.
- `GET/POST/DELETE /apps/{appId}/schedules` — App key allowed for per-app schedule management; admin token required for global schedule management.
- `POST /apps/{appId}/cache/purge` — App key allowed for internal purges; admin required for external/CDN purges.

Logging & audit
- All privileged operations (persisting credentials, shutdown destroy, global cache purge) must be recorded to the audit log with `actor` (token id or user), `ip`, and `timestamp`. Never log raw secrets.

Notes
- Feature flags in `src/config.ts` control gating: `ALLOW_SELF_SHUTDOWN`, `ALLOW_PERSIST_REGISTRY_CREDENTIALS`.
- If app-key actions need additional granularity, consider adding RBAC scopes (read, deploy, manage-schedules).
