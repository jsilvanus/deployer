import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _writeLock: Promise<void> = Promise.resolve();

export async function runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
  // Serialize write operations to avoid sqlite write contention across async handlers
  let release: () => void;
  const next = new Promise<void>(res => { release = res; });
  const prev = _writeLock;
  _writeLock = (async () => { await prev; await next; })();
  try {
    await prev; // wait previous to finish
    const result = await fn();
    return result as T;
  } finally {
    // allow next waiter to proceed
    // @ts-ignore - release is assigned above
    release();
  }
}

export function getDb(dbPath: string) {
  if (_db) return _db;
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  _db = drizzle(sqlite, { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;
