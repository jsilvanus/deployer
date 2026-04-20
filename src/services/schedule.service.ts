import { randomUUID } from 'node:crypto';
import { createRequire } from 'module';
const cronParser: any = createRequire(import.meta.url)('cron-parser');
import type { Db } from '../db/client.js';
import { schedules } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export class ScheduleService {
  constructor(private db: Db) {}

  async create(input: {
    appId: string; type: string; payload?: unknown; cron: string; timezone?: string; createdBy?: string;
  }) {
    const now = new Date();
    const id = randomUUID();
    const nextRun = this.computeNextRun(input.cron, input.timezone ?? 'UTC');
    await this.db.insert(schedules).values({
      id,
      appId: input.appId,
      type: input.type,
      payload: JSON.stringify(input.payload ?? {}),
      cron: input.cron,
      timezone: input.timezone ?? 'UTC',
      nextRun: nextRun !== null ? new Date(nextRun * 1000) : null,
      enabled: true,
      retryPolicy: JSON.stringify({}),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async listForDue(now = new Date()): Promise<typeof schedules.$inferSelect[]> {
    const rows = await this.db.select().from(schedules);
    const nowSec = Math.floor(now.getTime() / 1000);
    function nextRunToSeconds(v: unknown): number | null {
      if (v == null) return null;
      if (v instanceof Date) return Math.floor(v.getTime() / 1000);
      if (typeof v === 'number') return Math.floor(v);
      const n = Number(v as any);
      return Number.isFinite(n) ? Math.floor(n) : null;
    }
    return rows.filter(r => {
      if (!r.enabled) return false;
      const nr = nextRunToSeconds((r as any).nextRun);
      return nr !== null && nr <= nowSec;
    });
  }

  async listAll(): Promise<typeof schedules.$inferSelect[]> {
    return this.db.select().from(schedules);
  }

  async listForApp(appId: string): Promise<typeof schedules.$inferSelect[]> {
    return this.db.select().from(schedules).where(eq(schedules.appId, appId));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schedules).where(eq(schedules.id, id));
  }

  async updateNextRun(id: string): Promise<number | null> {
    const [row] = await this.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    if (!row) return null;
    const next = this.computeNextRun(row.cron, row.timezone ?? 'UTC');
    await this.db.update(schedules).set({ nextRun: next !== null ? new Date(next * 1000) : null, updatedAt: new Date() }).where(eq(schedules.id, id));
    return next;
  }

  computeNextRun(cronExpr: string, tz: string): number | null {
    try {
      const it = (cronParser as any).parseExpression(cronExpr, { tz });
      const next = it.next().toDate();
      return Math.floor(next.getTime() / 1000);
    } catch (err) {
      return null;
    }
  }
}

export default ScheduleService;
