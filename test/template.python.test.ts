import { describe, it, expect } from 'vitest';
import { generatePythonDockerfile } from '../src/templates/python.dockerfile';

describe('Python Dockerfile template', () => {
  it('generates a Dockerfile for requirements-based projects', () => {
    const txt = generatePythonDockerfile({ baseImage: 'python:3.11-slim', usePep517: false, requirementsFile: 'requirements.txt', startCmd: 'gunicorn app:app', exposePort: 8080 });
    expect(txt).toContain('FROM python:3.11-slim AS builder');
    expect(txt).toContain('pip install -r requirements.txt');
    expect(txt).toContain('EXPOSE 8080');
    expect(txt).toContain('CMD ["/bin/sh", "-c", "gunicorn app:app"]');
  });

  it('generates a Dockerfile for pep517 projects', () => {
    const txt = generatePythonDockerfile({ usePep517: true });
    expect(txt).toContain('pip install --upgrade pip build');
    expect(txt).toContain('pip install .');
  });
});
