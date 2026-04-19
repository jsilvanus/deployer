import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

export interface GitCredentials {
  token?: string;
  username?: string;
}

export class GitService {
  constructor(private logger: AnyLogger) {}

  private credentialArgs(creds: GitCredentials): string[] {
    if (!creds.token) return [];
    if (creds.username) {
      const encoded = Buffer.from(`${creds.username}:${creds.token}`).toString('base64');
      return ['-c', `http.extraHeader=Authorization: Basic ${encoded}`];
    }
    return ['-c', `http.extraHeader=Authorization: Bearer ${creds.token}`];
  }

  async clone(repoUrl: string, targetPath: string, branch: string, creds?: GitCredentials): Promise<void> {
    this.logger.info({ repoUrl, targetPath, branch }, 'git clone');
    const credArgs = creds ? this.credentialArgs(creds) : [];
    await execa('git', [...credArgs, 'clone', '--branch', branch, '--depth', '1', repoUrl, targetPath]);
  }

  async pull(repoPath: string, creds?: GitCredentials): Promise<void> {
    this.logger.info({ repoPath }, 'git pull');
    const credArgs = creds ? this.credentialArgs(creds) : [];
    await execa('git', [...credArgs, 'pull'], { cwd: repoPath });
  }

  async getCurrentHash(repoPath: string): Promise<string> {
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
    return stdout.trim();
  }

  async resetHard(repoPath: string, commitHash: string): Promise<void> {
    this.logger.info({ repoPath, commitHash }, 'git reset --hard');
    await execa('git', ['reset', '--hard', commitHash], { cwd: repoPath });
  }

  async tag(repoPath: string, tagName: string): Promise<void> {
    await execa('git', ['tag', '-f', tagName], { cwd: repoPath });
  }

  async getLog(repoPath: string, limit = 10): Promise<string[]> {
    const { stdout } = await execa(
      'git',
      ['log', `--max-count=${limit}`, '--oneline'],
      { cwd: repoPath },
    );
    return stdout.trim().split('\n').filter(Boolean);
  }
}
