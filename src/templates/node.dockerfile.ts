export interface NodeDockerfileOptions {
  baseImage?: string;
  buildArgs?: Record<string, string>;
  installCommand?: string;
  buildCommand?: string | null;
  startCmd?: string | null;
}

export function generateNodeDockerfile(opts: NodeDockerfileOptions = {}): string {
  const base = opts.baseImage || 'node:18-alpine';
  const install = opts.installCommand || 'npm ci';
  const buildCmd = opts.buildCommand || null;
  const startCmd = opts.startCmd || null;

  const lines: string[] = [];

  lines.push(`# Generated Dockerfile for Node.js application`);
  lines.push(`FROM ${base} AS builder`);
  lines.push(`WORKDIR /app`);
  lines.push(`COPY package*.json ./`);
  lines.push(`RUN ${install}`);
  if (buildCmd) {
    lines.push(`COPY . .`);
    lines.push(`RUN ${buildCmd}`);
  } else {
    lines.push(`COPY . .`);
  }

  lines.push(`FROM node:18-alpine AS runtime`);
  lines.push(`WORKDIR /app`);
  if (buildCmd) {
    lines.push(`COPY --from=builder /app .`);
  } else {
    lines.push(`COPY --from=builder /app .`);
  }
  if (startCmd) {
    lines.push(`CMD ["/bin/sh", "-c", "${startCmd}"]`);
  } else {
    lines.push(`CMD ["node", "dist/index.js"]`);
  }

  return lines.join('\n') + '\n';
}

export default generateNodeDockerfile;
