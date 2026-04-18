# Ideas / Future Work

## docker→node reachability (host.docker.internal)
Containers on `deployer-internal` cannot reach bare metal node apps without
`--add-host=host.docker.internal:host-gateway` in the container config.
Could be injected automatically into `docker-compose.internal.yml` when the
deployer detects a mix of node and docker/compose apps on the same server.
