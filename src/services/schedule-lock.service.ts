import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { scheduleLocks } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export class ScheduleLockService {
  constructor(private db: Db) {}

  async tryAcquire(scheduleId: string, owner?: string, ttlSeconds = 300) {
    const now = new Date();
    const ownerId = owner ?? randomUUID();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      await this.db.insert(scheduleLocks).values({ scheduleId, owner: ownerId, expiresAt }).run();
      return { acquired: true, owner: ownerId };
    } catch {
      // existing lock: check expiry
      const [row] = await this.db.select().from(scheduleLocks).where(eq(scheduleLocks.scheduleId, scheduleId)).limit(1);
      if (!row) return { acquired: false };
      if (row.expiresAt.getTime() <= now.getTime()) {
        // steal lock
        await this.db.update(scheduleLocks).set({ owner: ownerId, expiresAt }).where(eq(scheduleLocks.scheduleId, scheduleId));
        return { acquired: true, owner: ownerId };
      }
      return { acquired: false, owner: row.owner };
    }
  }

  async release(scheduleId: string, owner: string) {
    const [row] = await this.db.select().from(scheduleLocks).where(eq(scheduleLocks.scheduleId, scheduleId)).limit(1);
    if (!row) return false;
    if (row.owner !== owner) return false;
    await this.db.delete(scheduleLocks).where(eq(scheduleLocks.scheduleId, scheduleId));
    return true;
  }
}

export default ScheduleLockService;
