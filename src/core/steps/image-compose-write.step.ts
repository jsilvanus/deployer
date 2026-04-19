import { join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import type { DeploymentStep } from '../orchestrator.js';

const COMPOSE_FILE = 'docker-compose.yml';
const SERVICE_NAME = 'app';

function generateCompose(imageRef: string, port?: number): string {
  const lines = [
    'services:',
    `  ${SERVICE_NAME}:`,
    `    image: ${imageRef}`,
    '    restart: unless-stopped',
    ...(port != null ? ['    ports:', `      - "${port}:${port}"`] : []),
    '    env_file:',
    '      - .env',
  ];
  return lines.join('\n') + '\n';
}

export const imageComposeWriteStep: DeploymentStep = {
  name: 'image-compose-write',
  reversible: true,

  async captureSnapshot(ctx): Promise<Record<string, unknown>> {
    const composePath = join(ctx.app.deployPath, COMPOSE_FILE);
    let previousContent: string | null = null;
    try {
      previousContent = await readFile(composePath, 'utf8');
    } catch { /* file doesn't exist yet on fresh deploy */ }
    return { composePath, previousContent };
  },

  async execute(ctx): Promise<void> {
    const packageName = ctx.app.packageName;
    if (!packageName) throw new Error('packageName is required for image app type');
    const tag = ctx.app.packageVersion ?? 'latest';
    const imageRef = `${packageName}:${tag}`;

    await mkdir(ctx.app.deployPath, { recursive: true });
    await writeFile(join(ctx.app.deployPath, COMPOSE_FILE), generateCompose(imageRef, ctx.app.port), 'utf8');
    ctx.logger.info({ imageRef, deployPath: ctx.app.deployPath }, 'image compose file written');
  },

  async rollback(ctx, snapshot): Promise<void> {
    const { composePath, previousContent } = snapshot as { composePath: string; previousContent: string | null };
    if (previousContent === null) {
      try { await unlink(composePath); } catch { /* already gone */ }
    } else {
      await writeFile(composePath, previousContent, 'utf8');
    }
  },
};
