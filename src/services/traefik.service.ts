import { execa } from 'execa';

export type TraefikMode = 'standalone' | 'behind-nginx';

export class TraefikService {
  async detectMode(): Promise<TraefikMode> {
    try {
      await execa('nginx', ['-v']);
      return 'behind-nginx';
    } catch {
      return 'standalone';
    }
  }

  generateCompose(mode: TraefikMode, opts: { acmeEmail?: string; port: number }): string {
    return mode === 'standalone'
      ? this.standaloneCompose(opts.acmeEmail ?? '')
      : this.behindNginxCompose(opts.port);
  }

  generateNginxConfig(port: number): string {
    return [
      '# deployer-managed: traefik',
      'server {',
      '    listen 80 default_server;',
      '    listen [::]:80 default_server;',
      '    server_name _;',
      '',
      '    location / {',
      `        proxy_pass http://127.0.0.1:${port};`,
      '        proxy_http_version 1.1;',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '    }',
      '}',
    ].join('\n');
  }

  generateAppOverride(opts: {
    appName: string;
    primaryService: string;
    domain: string;
    port: number;
    mode: TraefikMode;
  }): string {
    const { appName, primaryService, domain, port, mode } = opts;
    const labels = [
      `      - traefik.enable=true`,
      `      - traefik.http.routers.${appName}.rule=Host(\`${domain}\`)`,
      `      - traefik.http.routers.${appName}.entrypoints=${mode === 'standalone' ? 'websecure' : 'web'}`,
      ...(mode === 'standalone'
        ? [`      - traefik.http.routers.${appName}.tls.certresolver=letsencrypt`]
        : []),
      `      - traefik.http.services.${appName}.loadbalancer.server.port=${port}`,
    ].join('\n');

    return `services:
  ${primaryService}:
    labels:
${labels}
    networks:
      - traefik

networks:
  traefik:
    external: true
`;
  }

  private standaloneCompose(acmeEmail: string): string {
    return `services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=traefik
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.tlschallenge=true
      - --certificatesresolvers.letsencrypt.acme.email=${acmeEmail}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-letsencrypt:/letsencrypt
    networks:
      - traefik

networks:
  traefik:
    name: traefik

volumes:
  traefik-letsencrypt:
`;
  }

  private behindNginxCompose(port: number): string {
    return `services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=traefik
      - --entrypoints.web.address=:80
    ports:
      - "127.0.0.1:${port}:80"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - traefik

networks:
  traefik:
    name: traefik
`;
  }
}
