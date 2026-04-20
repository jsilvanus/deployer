import { describe, it, expect } from 'vitest';
import path from 'path';
import AppDetectionService from '../src/services/app-detection.service';

describe('AppDetectionService', () => {
  it('detects a simple node app from package.json', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'node-basic');
    const svc = new AppDetectionService(fixture);
    const res = await svc.detect();
    expect(res.type).toBe('node');
    expect(res.confidence).toBe('high');
    expect(res.installCmd).toMatch(/npm/);
    expect(res.buildCommand).toBe('npm run build');
    expect(res.startCommand).toBe('npm start');
    expect(res.rawHints).toContain('package.json');
  });

  it('detects a python-pypi project from pyproject.toml', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'python-pypi');
    const svc = new AppDetectionService(fixture);
    const res = await svc.detect();
    expect(res.type).toBe('python-pypi');
    expect(res.confidence).toBe('high');
    expect(res.installCmd).toBe('pip install .');
    expect(res.rawHints).toContain('pyproject.toml');
  });

  it('detects a generic python app from app.py', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'python-generic');
    const svc = new AppDetectionService(fixture);
    const res = await svc.detect();
    expect(res.type).toBe('python');
    expect(res.confidence).toBe('medium');
    expect(res.installCmd).toBeUndefined();
    expect(res.rawHints).toContain('app.py/wsgi.py/manage.py');
  });

  it('honors DEPLOYER_FORCE_CONTAINER_TYPE env override', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'node-basic');
    process.env['DEPLOYER_FORCE_CONTAINER_TYPE'] = 'python';
    const svc = new AppDetectionService(fixture);
    const res = await svc.detectWithOverrides();
    expect(res.type).toBe('python');
    expect(res.confidence).toBe('high');
    delete process.env['DEPLOYER_FORCE_CONTAINER_TYPE'];
  });

  it('honors deployer.container.json file override', async () => {
    const fixtureDir = path.join(__dirname, 'fixtures', 'node-basic');
    const overrideFile = path.join(fixtureDir, 'deployer.container.json');
    await (await import('fs/promises')).writeFile(overrideFile, JSON.stringify({ type: 'docker' }), 'utf8');
    const svc = new AppDetectionService(fixtureDir);
    const res = await svc.detectWithOverrides();
    expect(res.type).toBe('docker');
    expect(res.confidence).toBe('high');
    // cleanup
    await (await import('fs/promises')).unlink(overrideFile);
  });
});
