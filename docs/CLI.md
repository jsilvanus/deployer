# CLI Usage and Examples

This document explains the CLI, how it maps to the HTTP API, and common usage patterns.

Authentication
- The CLI calls the server API by default. Provide an admin token with `--token` or via `DEPLOYER_ADMIN_TOKEN` env var.

Basic examples
- List apps:

```bash
deployer list --host http://127.0.0.1:3000 --token $DEPLOYER_ADMIN_TOKEN
```

- Create app (reads JSON from stdin):

```bash
cat new-app.json | deployer create --host http://127.0.0.1:3000 --token $DEPLOYER_ADMIN_TOKEN
```

- Deploy an app and wait for completion:

```bash
deployer deploy my-app --wait --host http://127.0.0.1:3000 --token $DEPLOYER_ADMIN_TOKEN
```

- Stream logs from an app (SSE):

```bash
deployer logs my-app --follow --host http://127.0.0.1:3000 --token $DEPLOYER_ADMIN_TOKEN
```

Notes
- `--wait` polls the deployment status endpoint until the deployment reaches a terminal state.
- `--follow` attaches to the server's SSE log stream and prints events to stdout.
