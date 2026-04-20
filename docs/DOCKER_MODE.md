# Docker-mode (DEPLOYER_RUNTIME_MODE)

When Deployer runs in Docker-mode it prefers container-based deployments (Compose/images) and enables auto-containerization features.

Environment variables:

- `DEPLOYER_RUNTIME_MODE`: `host` (default) or `docker`. If set to `docker`, Deployer enables Docker-mode features.
- `DEPLOYER_DOCKER_MODE`: legacy boolean flag (kept for backward compatibility).
- `DEPLOYER_IMAGE_BUILDER`: `docker` (default) or `podman`.
- `DEPLOYER_BASE_NODE_IMAGE`: base Node.js image to use for generated Dockerfiles (default: `node:18-alpine`).
- `DEPLOYER_BASE_PYTHON_IMAGE`: base Python image for generated Dockerfiles (default: `python:3.11-slim`).
- `DEPLOYER_IMAGE_TAG_PREFIX`: tag prefix to use when building images (default: `deployer`).
- `DEPLOYER_IMAGE_BUILD_ARGS`: optional extra build-args string passed to the image builder.
- `DEPLOYER_IMAGE_BUILD_TIMEOUT_SECONDS`: timeout for image build operations (default: 300s).

Required host tools when running in Docker-mode:

- `git` — required for fetching application repositories.
- `docker` and `docker compose` (or `podman`) — required for building and running images/compose.
- `nginx` — only if `nginxEnabled: true` on an app and host-intended routing is used.

Notes:

- `DEPLOYER_RUNTIME_MODE=docker` will cause the config helper `effectiveConfig()` to set `dockerMode=true` for compatibility with existing code paths.
- These defaults are conservative; templates and build behavior can be customized via the config options above.
