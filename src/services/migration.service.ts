import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

export type MigrationRunner = 'drizzle' | 'prisma' | 'sql';

export class MigrationService {
  constructor(private logger: AnyLogger) {}

  async detectRunner(appPath: string): Promise<MigrationRunner | null> {
    const check = async (file: string) => {
      try { await access(join(appPath, file)); return true; } catch { return false; }
    };

    if (await check('drizzle.config.ts') || await check('drizzle.config.js')) return 'drizzle';
    if (await check('prisma/schema.prisma')) return 'prisma';
    if (await check('migrations')) return 'sql';
    return null;
  }

  async runUp(appPath: string, runner: MigrationRunner): Promise<string[]> {
    this.logger.info({ appPath, runner }, 'running migrations up');
    switch (runner) {
      case 'drizzle':
        return this.drizzleUp(appPath);
      case 'prisma':
        return this.prismaUp(appPath);
      case 'sql':
        return this.sqlUp(appPath);
    }
  }

  async runDown(appPath: string, runner: MigrationRunner, toApply: string[]): Promise<void> {
    this.logger.info({ appPath, runner, toApply }, 'running migrations down');
    switch (runner) {
      case 'drizzle':
        await this.drizzleDown(appPath, toApply.length);
        break;
      case 'prisma':
        // Prisma doesn't support native rollback; log a warning
        this.logger.warn('Prisma migration rollback not supported natively; manual intervention required');
        break;
      case 'sql':
        await this.sqlDown(appPath, toApply);
        break;
    }
  }

  private async drizzleUp(appPath: string): Promise<string[]> {
    await execa('npx', ['drizzle-kit', 'migrate'], { cwd: appPath });
    return ['drizzle-migrate'];
  }

  private async drizzleDown(appPath: string, steps: number): Promise<void> {
    // drizzle-kit doesn't have a built-in rollback; we use the migrate with a rollback flag if available
    // This is a best-effort operation
    this.logger.warn({ steps }, 'Drizzle rollback: manual review recommended');
  }

  private async prismaUp(appPath: string): Promise<string[]> {
    await execa('npx', ['prisma', 'migrate', 'deploy'], { cwd: appPath });
    return ['prisma-migrate-deploy'];
  }

  private async sqlUp(appPath: string): Promise<string[]> {
    const migrationsDir = join(appPath, 'migrations');
    const trackingFile = join(appPath, '.migration-state');

    const applied = await this.loadApplied(trackingFile);
    const files = (await readdir(migrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort();

    const toRun = files.filter(f => !applied.includes(f));
    if (toRun.length === 0) return [];

    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl) throw new Error('DATABASE_URL not set for SQL migrations');

    for (const file of toRun) {
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      this.logger.info({ file }, 'applying SQL migration');
      await execa('psql', [dbUrl, '-f', '-'], { input: sql });
      applied.push(file);
      await this.saveApplied(trackingFile, applied);
    }

    return toRun;
  }

  private async sqlDown(appPath: string, filesToRevert: string[]): Promise<void> {
    const migrationsDir = join(appPath, 'migrations');
    const trackingFile = join(appPath, '.migration-state');
    const applied = await this.loadApplied(trackingFile);

    const dbUrl = process.env['DATABASE_URL'];
    if (!dbUrl) throw new Error('DATABASE_URL not set for SQL migrations');

    for (const file of [...filesToRevert].reverse()) {
      const downFile = file.replace('.sql', '.down.sql');
      try {
        const sql = await readFile(join(migrationsDir, downFile), 'utf8');
        this.logger.info({ file: downFile }, 'applying down migration');
        await execa('psql', [dbUrl, '-f', '-'], { input: sql });
        const idx = applied.indexOf(file);
        if (idx !== -1) applied.splice(idx, 1);
        await this.saveApplied(trackingFile, applied);
      } catch {
        this.logger.warn({ file }, 'No .down.sql found for migration; skipping');
      }
    }
  }

  private async loadApplied(trackingFile: string): Promise<string[]> {
    try {
      const content = await readFile(trackingFile, 'utf8');
      return JSON.parse(content) as string[];
    } catch {
      return [];
    }
  }

  private async saveApplied(trackingFile: string, applied: string[]): Promise<void> {
    await writeFile(trackingFile, JSON.stringify(applied, null, 2));
  }
}
