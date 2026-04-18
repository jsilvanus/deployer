import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

export interface PgConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

const DEFAULT_PG: PgConnection = { host: 'localhost', port: 5432, user: 'postgres', password: '' };

export class DatabaseService {
  constructor(
    private logger: AnyLogger,
    private pg: PgConnection = DEFAULT_PG,
  ) {}

  private args(): string[] {
    return ['-h', this.pg.host, '-p', String(this.pg.port), '-U', this.pg.user];
  }

  private env(): Record<string, string> {
    return { ...(process.env as Record<string, string>), PGPASSWORD: this.pg.password };
  }

  private async psql(sql: string): Promise<string> {
    const { stdout } = await execa('psql', [...this.args(), '-c', sql], { env: this.env() });
    return stdout;
  }

  async createDatabase(dbName: string): Promise<void> {
    this.logger.info({ dbName }, 'creating database');
    await this.psql(`CREATE DATABASE "${dbName}"`);
  }

  async createUser(dbUser: string, password: string): Promise<void> {
    this.logger.info({ dbUser }, 'creating db user');
    await this.psql(`CREATE USER "${dbUser}" WITH PASSWORD '${password}'`);
  }

  async grantAll(dbName: string, dbUser: string): Promise<void> {
    await this.psql(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);
  }

  async databaseExists(dbName: string): Promise<boolean> {
    const { stdout } = await execa(
      'psql',
      [...this.args(), '-tAc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`],
      { env: this.env() },
    );
    return stdout.trim() === '1';
  }

  async dropDatabase(dbName: string): Promise<void> {
    this.logger.warn({ dbName }, 'dropping database');
    await this.psql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}'`,
    );
    await this.psql(`DROP DATABASE IF EXISTS "${dbName}"`);
  }

  async dropUser(dbUser: string): Promise<void> {
    await this.psql(`DROP USER IF EXISTS "${dbUser}"`);
  }
}
