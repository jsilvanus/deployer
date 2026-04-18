import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { AppEnvService } from '../../services/app-env.service.js';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const COMPOSE_FILE = 'docker-compose.yml';

export const composeWriteStep: DeploymentStep = {
  name: 'compose-write',
  reversible: true,

  async captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>> {
    const composePath = join(ctx.app.deployPath, COMPOSE_FILE);
    let previousContent: string | null = null;
    try {
      previousContent = await readFile(composePath, 'utf8');
    } catch {
      // file doesn't exist yet on fresh deploy
    }
    return { composePath, previousContent };
  },

  async execute(ctx: StepContext): Promise<void> {
    const envSvc = new AppEnvService(ctx.db, ctx.config.envEncryptionKey);
    const content = await envSvc.get(ctx.app.id, '_COMPOSE_CONTENT');
    if (!content) {
      throw new Error('No compose content stored for this app. Set composeContent when registering.');
    }
    await mkdir(ctx.app.deployPath, { recursive: true });
    await writeFile(join(ctx.app.deployPath, COMPOSE_FILE), content, 'utf8');
    ctx.logger.info({ deployPath: ctx.app.deployPath }, 'compose file written');
  },

  async rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void> {
    const { composePath, previousContent } = snapshot as {
      composePath: string;
      previousContent: string | null;
    };
    if (previousContent === null) {
      try { await unlink(composePath); } catch { /* already gone */ }
    } else {
      await writeFile(composePath, previousContent, 'utf8');
    }
  },
};
