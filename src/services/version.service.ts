import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';

type CacheEntry = { value: unknown; fetchedAt: number };

export class VersionService {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;

  constructor(private db: Db, private upstreamUrl?: string, cacheTtlMs = 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  async getLocalVersion(appId: string): Promise<string | null> {
    const row = await this.db.select().from('apps' as any).where({ id: appId }).limit(1);
    // fallback: read packageVersion column if present
    const app = Array.isArray(row) ? row[0] : row;
    if (!app) return null;
    return app.packageVersion ?? null;
  }
  async getUpstreamLatest(key: string): Promise<{ version: string } | null> {
    return this.getLatest(key, false);
  }

  async getLatest(key: string, refresh = false): Promise<{ version: string } | null> {
    if (!this.upstreamUrl) return null;
    const cacheKey = `upstream:${key}`;
    const cached = this.cache.get(cacheKey);
    if (!refresh && cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
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
