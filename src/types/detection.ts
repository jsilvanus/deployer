export type AppType = 'node' | 'python-pypi' | 'python' | 'docker' | 'compose' | 'unknown';

export interface DetectionResult {
  type: AppType;
  entrypoint?: string; // suggested start command
  installCmd?: string; // how to install deps
  buildCommand?: string; // how to build the app
  testCommand?: string; // how to run tests, if detected
  startCommand?: string; // explicit start command if different from entrypoint
  ports?: number[]; // suggested exposed ports
  envFiles?: string[]; // e.g., [".env"]
  buildSystem?: string; // e.g., npm, yarn, pip, poetry, pep517
  healthcheck?: { type: 'http' | 'tcp'; path?: string; port?: number } | null;
  confidence: 'high' | 'medium' | 'low';
  rawHints: string[]; // files/fields that influenced the result
}
