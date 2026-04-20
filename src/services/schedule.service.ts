import { randomUUID } from 'node:crypto';
import { parseExpression } from 'cron-parser';
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
      nextRun,
      enabled: true,
      retryPolicy: JSON.stringify({}),
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async listForDue(now = new Date()) {
    const rows = await this.db.select().from(schedules);
    return rows.filter(r => r.enabled && r.nextRun && r.nextRun <= now);
  }

  async listAll() {
    return this.db.select().from(schedules);
  }

  async listForApp(appId: string) {
    return this.db.select().from(schedules).where(eq(schedules.appId, appId));
  }

  async delete(id: string) {
    await this.db.delete(schedules).where(eq(schedules.id, id));
  }

  async updateNextRun(id: string) {
    const [row] = await this.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    if (!row) return null;
    const next = this.computeNextRun(row.cron, row.timezone ?? 'UTC');
    await this.db.update(schedules).set({ nextRun: next, updatedAt: new Date() }).where(eq(schedules.id, id));
    return next;
  }

  computeNextRun(cronExpr: string, tz: string) {
    try {
      const it = parseExpression(cronExpr, { tz });
      const next = it.next().toDate();
      return next;
    } catch (err) {
      return null;
    }
  }
}

export default ScheduleService;
