import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { apps } from '../db/schema.js';
import { eq } from 'drizzle-orm';

type CacheEntry = { value: unknown; fetchedAt: number };

export class VersionService {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;

  constructor(private db: Db, private upstreamUrl?: string, cacheTtlMs = 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  async getLocalVersion(appId: string): Promise<string | null> {
    const row = await this.db.select().from(apps).where(eq(apps.id, appId)).limit(1);
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
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url.toString(), { method: 'GET', signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      const versionVal = obj['latest'] ?? obj['version'];
      const result = versionVal ? { version: String(versionVal) } : { version: String(data) };
      this.cache.set(cacheKey, { value: result, fetchedAt: Date.now() });
      return result;
    } catch {
      return null;
    }
  }
}

export default VersionService;
