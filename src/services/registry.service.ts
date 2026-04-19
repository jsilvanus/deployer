import fetch from 'node-fetch';
import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

export class RegistryService {
  constructor(private logger: AnyLogger) {}

  async testCredentials(provider: string, target: string, credentials?: Record<string, any>) {
    this.logger.info({ provider, target }, 'registry.test');
    try {
      if (provider === 'git') {
        // use git ls-remote to validate access
        try {
          await execa('git', ['ls-remote', target], { timeout: 10000 });
          return { success: true, message: 'git access OK' };
        } catch (err: any) {
          return { success: false, message: String(err.message || err) };
        }
      }

      if (provider === 'npm') {
        const url = `https://registry.npmjs.org/${encodeURIComponent(target)}`;
        const headers: Record<string, string> = {};
        if (credentials?.token) headers['authorization'] = `Bearer ${credentials.token}`;
        const res = await fetch(url, { method: 'GET', headers, timeout: 8000 });
        if (!res.ok) return { success: false, message: `Registry responded ${res.status}` };
        const data = await res.json();
        return { success: true, message: 'npm metadata fetched', tags: data['dist-tags'] ? Object.keys(data['dist-tags']) : [] };
      }

      if (provider === 'pypi') {
        const url = `https://pypi.org/pypi/${encodeURIComponent(target)}/json`;
        const res = await fetch(url, { method: 'GET', timeout: 8000 });
        if (!res.ok) return { success: false, message: `PyPI responded ${res.status}` };
        const data = await res.json();
        return { success: true, message: 'pypi metadata fetched', tags: Object.keys(data.releases || {}) };
      }

      if (provider === 'docker') {
        // Attempt docker registry v2 tags list. Target may include registry host and image name.
        // Example: registry.hub.docker.com/library/nginx
        const registry = credentials?.registryUrl || 'https://registry-1.docker.io';
        const image = target;
        const url = `${registry.replace(/\/$/, '')}/v2/${image}/tags/list`;
        const headers: Record<string, string> = {};
        if (credentials?.token) headers['authorization'] = `Bearer ${credentials.token}`;
        try {
          const res = await fetch(url, { method: 'GET', headers, timeout: 8000 });
          if (!res.ok) return { success: false, message: `Registry responded ${res.status}` };
          const data = await res.json();
          return { success: true, message: 'tags fetched', tags: data.tags || [] };
        } catch (err: any) {
          return { success: false, message: String(err.message || err) };
        }
      }

      return { success: false, message: `Unknown provider: ${provider}` };
    } catch (err: any) {
      return { success: false, message: String(err.message || err) };
    }
  }
}

export default RegistryService;
