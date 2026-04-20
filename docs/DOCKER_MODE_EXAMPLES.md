---
# Docker Mode — Examples & Notes

This page provides compact examples and operational notes for running apps in Docker/compose mode with the deployer.

Docker vs Compose
- `docker` app type: expects a Git repo with a `Dockerfile`. The deployer builds the image and runs it via `docker run` or a managed compose file.
- `compose` app type: expects a `docker-compose.yml` (or generated inline YAML). Use when your app spans multiple services.

Basic compose snippet
version: "3.8"
services:
  web:
    image: your-image:latest
    ports:
      - "80:3000"
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.myapp.rule=Host(`example.com`)"
    networks:
      - webnet
networks:
  webnet:
    external: false

Traefik integration example (labels)
- Add per-service labels in your compose file to integrate with Traefik:
  - `traefik.enable=true`
  - `traefik.http.routers.<name>.rule=Host('example.com')`
  - `traefik.http.services.<name>.loadbalancer.server.port=3000`

Internal networks
- For multi-container apps that must be isolated, set `internalNetwork: true` in the app config (if supported) or ensure your compose defines an internal network.

Volumes and persistence
- Mount host paths for uploads and DB files. Example:
  volumes:
    - /srv/apps/myapp/uploads:/app/uploads

Build-time considerations
- Use multi-stage builds in `Dockerfile` to avoid shipping build tools into the runtime image.

Common commands (host)
- Build locally for debugging:
  docker build -t myapp:debug .
- Run locally:
  docker run --rm -p 3000:3000 -e NODE_ENV=production myapp:debug

Security & permissions
- Avoid running containers as root where possible. Use `USER` in Dockerfile.
- Ensure deployer has access to docker daemon or is configured to use a remote docker host (check DOCKER_HOST).

---
