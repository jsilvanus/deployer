export interface PythonDockerfileOptions {
  baseImage?: string;
  usePep517?: boolean;
  requirementsFile?: string | null;
  startCmd?: string | null;
  exposePort?: number | null;
}

export function generatePythonDockerfile(opts: PythonDockerfileOptions = {}): string {
  const base = opts.baseImage || 'python:3.11-slim';
  const usePep517 = !!opts.usePep517;
  const reqFile = opts.requirementsFile || 'requirements.txt';
  const startCmd = opts.startCmd || null;
  const port = opts.exposePort || null;

  const lines: string[] = [];
  lines.push(`# Generated Dockerfile for Python application`);
  lines.push(`FROM ${base} AS builder`);
  lines.push(`WORKDIR /app`);
  lines.push(`ENV VIRTUAL_ENV=/opt/venv`);
  lines.push(`RUN python -m venv $VIRTUAL_ENV`);
  lines.push(`ENV PATH="$VIRTUAL_ENV/bin:$PATH"`);
  lines.push(`COPY pyproject.toml setup.py ${reqFile} ./`);
  if (usePep517) {
    lines.push(`RUN pip install --upgrade pip build && pip install build`);
    lines.push(`RUN pip install .`);
  } else if (reqFile) {
    lines.push(`RUN pip install --upgrade pip && if [ -f ${reqFile} ]; then pip install -r ${reqFile}; fi`);
  } else {
    lines.push(`RUN pip install --upgrade pip`);
  }

  lines.push(`FROM ${base} AS runtime`);
  lines.push(`WORKDIR /app`);
  lines.push(`ENV VIRTUAL_ENV=/opt/venv`);
  lines.push(`ENV PATH="$VIRTUAL_ENV/bin:$PATH"`);
  lines.push(`COPY --from=builder /opt/venv /opt/venv`);
  lines.push(`COPY . .`);
  if (port) lines.push(`EXPOSE ${port}`);
  if (startCmd) {
    lines.push(`CMD ["/bin/sh", "-c", "${startCmd}"]`);
  } else {
    lines.push(`CMD ["python", "app.py"]`);
  }

  return lines.join('\n') + '\n';
}

export default generatePythonDockerfile;
