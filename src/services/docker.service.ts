import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

export class DockerService {
  constructor(private logger: AnyLogger) {}

  async build(opts: {
    contextPath: string;
    imageName: string;
    imageTag: string;
    dockerfile?: string;
  }): Promise<void> {
    this.logger.info({ imageName: opts.imageName, tag: opts.imageTag }, 'docker build');
    const args = [
      'build',
      '-t', `${opts.imageName}:${opts.imageTag}`,
    ];
    if (opts.dockerfile) args.push('-f', opts.dockerfile);
    args.push(opts.contextPath);
    await execa('docker', args, { cwd: opts.contextPath });
  }

  async pull(imageName: string, tag = 'latest'): Promise<void> {
    this.logger.info({ imageName, tag }, 'docker pull');
    await execa('docker', ['pull', `${imageName}:${tag}`]);
  }

  async tag(imageName: string, sourceTag: string, targetTag: string): Promise<void> {
    await execa('docker', ['tag', `${imageName}:${sourceTag}`, `${imageName}:${targetTag}`]);
  }

  async removeImage(imageName: string, tag: string): Promise<void> {
    try {
      await execa('docker', ['rmi', `${imageName}:${tag}`]);
    } catch {
      // image may not exist
    }
  }

  async getImageId(imageName: string, tag: string): Promise<string | null> {
    try {
      const { stdout } = await execa('docker', [
        'images', '-q', `${imageName}:${tag}`,
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async composeUp(composePath: string, envFile?: string, overrideFiles: string[] = []): Promise<void> {
    this.logger.info({ composePath }, 'docker compose up');
    const args = ['compose'];
    if (overrideFiles.length > 0) {
      args.push('-f', 'docker-compose.yml', ...overrideFiles.flatMap(f => ['-f', f]));
    }
    args.push('up', '-d', '--build');
    if (envFile) args.push('--env-file', envFile);
    await execa('docker', args, { cwd: composePath });
  }

  async composeDown(composePath: string): Promise<void> {
    this.logger.info({ composePath }, 'docker compose down');
    await execa('docker', ['compose', 'down'], { cwd: composePath });
  }

  async composeServiceNames(composePath: string): Promise<string[]> {
    const { stdout } = await execa('docker', ['compose', 'config', '--services'], {
      cwd: composePath,
    });
    return stdout.trim().split('\n').filter(Boolean);
  }

  async networkCreate(name: string): Promise<void> {
    try {
      await execa('docker', ['network', 'create', '--driver', 'bridge', name]);
    } catch {
      // already exists — ignore
    }
  }

  async containerStatus(containerName: string): Promise<string | null> {
    try {
      const { stdout } = await execa('docker', [
        'inspect', '--format', '{{.State.Status}}', containerName,
      ]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async composePsStatus(composePath: string): Promise<{
    status: string;
    services: Array<{ name: string; state: string }>;
  }> {
    try {
      const { stdout } = await execa(
        'docker', ['compose', 'ps', '--format', 'json'],
        { cwd: composePath },
      );
      if (!stdout.trim()) return { status: 'not_found', services: [] };

      type PsRow = { Name: string; State: string };
      let rows: PsRow[];
      try {
        rows = JSON.parse(stdout) as PsRow[];
      } catch {
        rows = stdout.trim().split('\n').map(l => JSON.parse(l) as PsRow);
      }
      if (rows.length === 0) return { status: 'not_found', services: [] };

      const allRunning = rows.every(r => r.State === 'running');
      const status = allRunning ? 'running' : (rows.find(r => r.State !== 'running')?.State ?? 'unknown');
      return { status, services: rows.map(r => ({ name: r.Name, state: r.State })) };
    } catch {
      return { status: 'not_found', services: [] };
    }
  }

  async composeStats(composePath: string): Promise<Array<{
    name: string;
    cpu: number;
    memory: string;
    memoryPercent: number;
    pids: number;
  }>> {
    try {
      const { stdout: idOut } = await execa(
        'docker', ['compose', 'ps', '-q'],
        { cwd: composePath },
      );
      const ids = idOut.trim().split('\n').filter(Boolean);
      if (ids.length === 0) return [];

      const { stdout } = await execa('docker', [
        'stats', '--no-stream', '--format', 'json', ...ids,
      ]);
      if (!stdout.trim()) return [];

      type StatsRow = { Name: string; CPUPerc: string; MemUsage: string; MemPerc: string; PIDs: string };
      const rows: StatsRow[] = stdout.trim().split('\n').map(l => JSON.parse(l) as StatsRow);
      return rows.map(r => ({
        name:          r.Name,
        cpu:           parseFloat(r.CPUPerc),
        memory:        r.MemUsage,
        memoryPercent: parseFloat(r.MemPerc),
        pids:          parseInt(r.PIDs, 10),
      }));
    } catch {
      return [];
    }
  }
}
