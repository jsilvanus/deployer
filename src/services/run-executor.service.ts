import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';
import { DockerService } from './docker.service.js';

export interface RunSpec {
  runtime: 'node' | 'python' | 'image' | 'compose' | 'command';
  command?: string[];
  image?: string;
  service?: string;
  env?: Record<string, string>;
  timeoutSec?: number;
  ephemeral?: boolean;
}

export class RunExecutor {
  private docker: DockerService;
  constructor(private logger: AnyLogger) {
    this.docker = new DockerService(this.logger);
  }

  async execute(runSpec: RunSpec, opts: { cwd?: string } = {}): Promise<{ success: boolean; code?: number | null; stdout?: string; stderr?: string; error?: string }> {
    const timeout = (runSpec.timeoutSec ?? 300) * 1000;
    try {
      if (runSpec.runtime === 'image') {
        if (!runSpec.image) throw new Error('image is required for image runtime');
        // docker run --rm -e... image
        const args = ['run', '--rm'];
        if (runSpec.env) {
          for (const [k, v] of Object.entries(runSpec.env)) args.push('-e', `${k}=${v}`);
        }
        args.push(runSpec.image);
        const r = await execa('docker', args, { timeout });
        return { success: true, code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
      }

      if (runSpec.runtime === 'compose') {
        if (!runSpec.service) throw new Error('service is required for compose runtime');
        const composeCmd = ['compose', 'run', '--rm', runSpec.service];
        if (runSpec.command && runSpec.command.length > 0) composeCmd.push(...runSpec.command);
        const r = await execa('docker', composeCmd, { cwd: opts.cwd, timeout });
        return { success: true, code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
      }

      if (runSpec.runtime === 'node' || runSpec.runtime === 'python' || runSpec.runtime === 'command') {
        if (!runSpec.command || runSpec.command.length === 0) throw new Error('command is required for node/python/command runtimes');
        const cmd = runSpec.command[0];
        const args = runSpec.command.slice(1);
        const r = await execa(cmd, args, { cwd: opts.cwd, timeout, env: runSpec.env ?? process.env });
        return { success: true, code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
      }

      throw new Error('unsupported runtime');
    } catch (err: any) {
      const errorText = err?.message ?? String(err);
      this.logger.error({ err, runSpec }, 'RunExecutor execution failed');
      if (err?.stdout || err?.stderr) {
        return { success: false, code: err.exitCode ?? null, stdout: err.stdout, stderr: err.stderr, error: errorText };
      }
      return { success: false, error: errorText };
    }
  }
}

export default RunExecutor;
