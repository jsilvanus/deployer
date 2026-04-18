import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

interface Pm2ProcessInfo {
  name: string;
  pid: number | null;
  status: string;
  memory: number;
  cpu: number;
  uptime: number | null;
}

export class Pm2Service {
  constructor(private logger: AnyLogger) {}

  private async pm2(...args: string[]): Promise<string> {
    const { stdout } = await execa('pm2', args);
    return stdout;
  }

  async start(opts: {
    name: string;
    script: string;
    cwd: string;
    envFile?: string;
    interpreter?: string;
    instances?: number;
  }): Promise<void> {
    this.logger.info({ name: opts.name, interpreter: opts.interpreter }, 'pm2 start');
    const args = [
      'start', opts.script,
      '--name', opts.name,
      '--cwd', opts.cwd,
    ];
    if (opts.interpreter) args.push('--interpreter', opts.interpreter);
    if (opts.envFile) args.push('--env-file', opts.envFile);
    if (opts.instances) args.push('-i', String(opts.instances));
    await this.pm2(...args);
    await this.pm2('save');
  }

  async restart(name: string): Promise<void> {
    this.logger.info({ name }, 'pm2 restart');
    await this.pm2('restart', name);
  }

  async reload(name: string): Promise<void> {
    this.logger.info({ name }, 'pm2 reload');
    await this.pm2('reload', name);
  }

  async stop(name: string): Promise<void> {
    this.logger.info({ name }, 'pm2 stop');
    await this.pm2('stop', name);
  }

  async delete(name: string): Promise<void> {
    this.logger.info({ name }, 'pm2 delete');
    try {
      await this.pm2('delete', name);
      await this.pm2('save');
    } catch {
      // process may not exist; ignore
    }
  }

  async status(name: string): Promise<Pm2ProcessInfo | null> {
    try {
      const { stdout } = await execa('pm2', ['jlist']);
      const list = JSON.parse(stdout) as Array<{
        name: string;
        pid: number | null;
        pm2_env: { status: string; pm_uptime?: number };
        monit: { memory: number; cpu: number };
      }>;
      const proc = list.find(p => p.name === name);
      if (!proc) return null;
      return {
        name:    proc.name,
        pid:     proc.pid,
        status:  proc.pm2_env.status,
        memory:  proc.monit.memory,
        cpu:     proc.monit.cpu,
        uptime:  proc.pm2_env.pm_uptime ?? null,
      };
    } catch {
      return null;
    }
  }

  async list(): Promise<Pm2ProcessInfo[]> {
    const { stdout } = await execa('pm2', ['jlist']);
    const list = JSON.parse(stdout) as Array<{
      name: string;
      pid: number | null;
      pm2_env: { status: string; pm_uptime?: number };
      monit: { memory: number; cpu: number };
    }>;
    return list.map(p => ({
      name:   p.name,
      pid:    p.pid,
      status: p.pm2_env.status,
      memory: p.monit.memory,
      cpu:    p.monit.cpu,
      uptime: p.pm2_env.pm_uptime ?? null,
    }));
  }
}
