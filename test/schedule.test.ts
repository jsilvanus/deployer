import { describe, it, expect } from 'vitest';
import { ScheduleService } from '../src/services/schedule.service.js';

// Use a minimal fake DB with select that returns empty arrays for these unit tests
const fakeDb = {
  select: () => ({ from: () => [] }),
  insert: () => ({ values: () => Promise.resolve([{}]) }),
  delete: () => ({ where: () => Promise.resolve() }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
};

describe('ScheduleService', () => {
  it('computes next run for a valid cron', () => {
    const svc = new ScheduleService(fakeDb as any);
    const next = svc.computeNextRun('*/5 * * * *', 'UTC');
    expect(typeof next === 'number').toBe(true);
    expect(next).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
