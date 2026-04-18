import { execa } from 'execa';
import type { AnyLogger } from '../types/logger.js';

export class GitService {
  constructor(private logger: AnyLogger) {}

  async clone(repoUrl: string, targetPath: string, branch: string): Promise<void> {
    this.logger.info({ repoUrl, targetPath, branch }, 'git clone');
    await execa('git', ['clone', '--branch', branch, '--depth', '1', repoUrl, targetPath]);
  }

  async pull(repoPath: string): Promise<void> {
    this.logger.info({ repoPath }, 'git pull');
    await execa('git', ['pull'], { cwd: repoPath });
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
