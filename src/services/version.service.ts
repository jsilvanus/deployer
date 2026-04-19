import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';

type CacheEntry = { value: unknown; fetchedAt: number };

export class VersionService {
  private cache = new Map<string, CacheEntry>();

  constructor(private db: Db, private upstreamUrl?: string) {}

  async getLocalVersion(appId: string): Promise<string | null> {
    const row = await this.db.select().from('apps' as any).where({ id: appId }).limit(1);
    // fallback: read packageVersion column if present
    const app = Array.isArray(row) ? row[0] : row;
    if (!app) return null;
    return app.packageVersion ?? null;
  }

  async getUpstreamLatest(key: string): Promise<{ version: string } | null> {
    if (!this.upstreamUrl) return null;
    const cacheKey = `upstream:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 60 * 1000) {
      return cached.value as { version: string };
    }

    try {
      const url = new URL(this.upstreamUrl);
      url.searchParams.set('q', key);
      const res = await fetch(url.toString(), { method: 'GET', timeout: 5000 });
      if (!res.ok) return null;
      const data = await res.json();
      const result = (data && (data.latest || data.version)) ? { version: data.latest ?? data.version } : { version: String(data) };
      this.cache.set(cacheKey, { value: result, fetchedAt: Date.now() });
      return result;
    } catch {
      return null;
    }
  }
}

export default VersionService;
