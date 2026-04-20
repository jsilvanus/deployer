import { describe, it, expect } from 'vitest';
import { generateNodeDockerfile } from '../src/templates/node.dockerfile';

describe('Node Dockerfile template', () => {
  it('generates a Dockerfile with base image and install command', () => {
    const txt = generateNodeDockerfile({ baseImage: 'node:18-alpine', installCommand: 'npm ci', buildCommand: 'npm run build', startCmd: 'npm start' });
    expect(txt).toContain('FROM node:18-alpine AS builder');
    expect(txt).toContain('RUN npm ci');
    expect(txt).toContain('RUN npm run build');
    expect(txt).toContain('CMD ["/bin/sh", "-c", "npm start"]');
  });
});
