# CLI Specification — deployer

This document maps CLI subcommands to OpenAPI operations and specifies flags and behaviour for the `npx @jsilvanus/deployer` CLI.

## Global flags and env vars
- `--host` / `DEPLOYER_HOST` (default: `127.0.0.1`)
- `--port` / `DEPLOYER_PORT` (default: `3000`)
- `--token` / `DEPLOYER_ADMIN_TOKEN` (Bearer token for admin endpoints)
- `--config` path to JSON file with defaults (host, port, token)
- `--dry-run` boolean: show request payload without sending
- `--wait` boolean: for long-running operations wait for completion
- `--verbose` increase logging

For authentication the CLI prefers `--token` then `DEPLOYER_ADMIN_TOKEN` then `--config`.

## Subcommands mapping

- `add <json|@file>`
  - Method: POST
  - Path: /apps
  - Body: `CreateAppInput`
  - Response: `CreateAppResult`

- `update <appId> <json|@file>`
  - Method: PATCH
  - Path: /apps/{appId}
  - Body: `UpdateAppInput`

- `remove <appId>`
  - Method: DELETE
  - Path: /apps/{appId}

- `list`
  - Method: GET
  - Path: /apps

- `get <appId>`
  - Method: GET
  - Path: /apps/{appId}

- `deploy <appId> [--allow-db-drop] [--wait]` 
  - Method: POST
  - Path: /apps/{appId}/deploy
  - Body: `DeployRequest`

- `rollback <appId> <deploymentId> [--wait]`
  - Method: POST
  - Path: /deployments/{deploymentId}/rollback

- `status <appId>`
  - Method: GET
  - Path: /apps/{appId}/status

- `logs <appId> [--follow] [--since]`
  - Method: GET
  - Path: /apps/{appId}/logs
  - Streaming: SSE or poll depending on server support

- `metrics <appId> [--from] [--to]`
  - Method: GET
  - Path: /apps/{appId}/metrics

- `setup` (interactive)
  - Invokes local `bin/setup.js` script — runs in-process, not via API

- `server`
  - Starts the server locally — runs in-process, not via API

## Error handling and exit codes
- 0: success
- 1: usage / unknown command
- 2: bad input / missing args / auth missing
- 3: API returned non-2xx
- 4: network or client error

## Retry and timeouts
- Default request timeout: 20s
- Retries: idempotent GET/HEAD/PUT/DELETE can be retried up to 2 times with exponential backoff; POSTs are not retried unless `--retry` is provided.

## Idempotency
- For actions that create resources (`add`, `deploy`) the client may attach an `Idempotency-Key` header when `--idempotency-key` is provided by the user.

## Example usage
```
npx @jsilvanus/deployer add @app.json --token $ADMIN_TOKEN
npx @jsilvanus/deployer update my-app-id @update.json --host 192.168.1.2 --port 3000
npx @jsilvanus/deployer deploy my-app-id --wait --token $ADMIN_TOKEN
```

## Notes
- All CLI commands default to making HTTP API calls to the server except `server` and `setup` which run locally. This ensures server-side logging and DB writes remain authoritative.
