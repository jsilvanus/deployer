import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { execa } from 'execa';
import type { FastifyInstance } from 'fastify';
import { AppService } from '../../services/app.service.js';
import { appIdParam } from '../schemas/app.schema.js';
import type { Db } from '../../db/client.js';
import type { Config } from '../../config.js';

function pm2LogPath(name: string, stream: 'out' | 'err'): string {
  const pm2Home = process.env['PM2_HOME'] ?? join(homedir(), '.pm2');
  return join(pm2Home, 'logs', `${name}-${stream}.log`);
}

async function tailLines(filePath: string, lines: number): Promise<string> {
  try {
    await access(filePath);
  } catch {
    return '';
  }
  const content = await readFile(filePath, 'utf8');
  return content.split('\n').slice(-lines).join('\n');
}

export async function logsRoutes(fastify: FastifyInstance, opts: { db: Db; config: Config }) {
  const appSvc = new AppService(opts.db, opts.config.envEncryptionKey);

  // ── Tail ──────────────────────────────────────────────────────────────────

  fastify.get('/apps/:appId/logs', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    const query = request.query as { lines?: string; stderr?: string };
    const lines = Math.min(parseInt(query.lines ?? '100', 10) || 100, 5000);

    if (app.type === 'node' || app.type === 'python') {
      const [stdout, stderr] = await Promise.all([
        tailLines(pm2LogPath(app.name, 'out'), lines),
        query.stderr !== 'false' ? tailLines(pm2LogPath(app.name, 'err'), lines) : Promise.resolve(''),
      ]);
      return { appId, appName: app.name, stdout, stderr };
    } else {
      try {
        const { stdout } = await execa(
          'docker', ['compose', 'logs', '--tail', String(lines), '--no-color'],
          { cwd: app.deployPath },
        );
        return { appId, appName: app.name, stdout, stderr: '' };
      } catch {
        return { appId, appName: app.name, stdout: '', stderr: '' };
      }
    }
  });

  // ── Live stream (SSE) ─────────────────────────────────────────────────────

  fastify.get('/apps/:appId/logs/stream', {
    schema: { params: appIdParam },
  }, async (request, reply) => {
    const { appId } = request.params as { appId: string };
    if (!request.isAdmin && request.scopedAppId !== appId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const app = await appSvc.findById(appId);
    if (!app) return reply.code(404).send({ error: 'App not found' });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type':    'text/event-stream; charset=utf-8',
      'Cache-Control':   'no-cache',
      'Connection':      'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const proc = app.type === 'node' || app.type === 'python'
      ? spawn('tail', ['-f', '-n', '0', pm2LogPath(app.name, 'out')])
      : spawn('docker', ['compose', 'logs', '-f', '--no-color', '--tail=0'], {
          cwd: app.deployPath,
        });

    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    await new Promise<void>(resolve => {
      request.raw.on('close', () => { proc.kill(); resolve(); });
      proc.on('exit', resolve);
    });

    res.end();
  });
}
