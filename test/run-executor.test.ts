import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide a module mock for execa that is a mock function
vi.mock('execa', () => ({ execa: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })) }));

import RunExecutor from '../src/services/run-executor.service';

const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} } as any;

describe('RunExecutor', () => {
  beforeEach(async () => {
    const { execa } = await import('execa');
    (execa as any).mockClear();
  });

  it('runs image runtime via docker run', async () => {
    const r = new RunExecutor(fakeLogger);
    const res = await r.execute({ runtime: 'image', image: 'alpine:latest' });
    expect(res.success).toBe(true);
    const { execa } = await import('execa');
    expect(execa).toHaveBeenCalled();
    const [cmd, args] = execa.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args).toEqual(expect.arrayContaining(['run', '--rm', 'alpine:latest']));
  });

  it('runs compose runtime via docker compose run', async () => {
    const r = new RunExecutor(fakeLogger);
    const res = await r.execute({ runtime: 'compose', service: 'worker', command: ['echo', 'hi'] }, { cwd: '/tmp' });
    expect(res.success).toBe(true);
    const { execa } = await import('execa');
    expect(execa).toHaveBeenCalled();
    const [cmd, args, opts] = execa.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args.slice(0, 4)).toEqual(['compose', 'run', '--rm', 'worker']);
    expect(opts.cwd).toBe('/tmp');
  });

  it('runs node runtime by executing command', async () => {
    const r = new RunExecutor(fakeLogger);
    const res = await r.execute({ runtime: 'node', command: ['node', 'script.js', 'arg1'] }, { cwd: '.' });
    expect(res.success).toBe(true);
    const { execa } = await import('execa');
    expect(execa).toHaveBeenCalled();
    const [cmd, args] = execa.mock.calls[0];
    expect(cmd).toBe('node');
    expect(args).toEqual(['script.js', 'arg1']);
  });
});
