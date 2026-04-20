import { promises as fs } from 'fs';
import path from 'path';
import { DetectionResult } from '../types/detection';

export class AppDetectionService {
  root: string;
  constructor(root: string) {
    this.root = root;
  }

  async fileExists(rel: string) {
    try {
      await fs.access(path.join(this.root, rel));
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Very small, conservative detection implementation.
   * Returns a DetectionResult with confidence and rawHints.
   */
  async detect(): Promise<DetectionResult> {
    const hints: string[] = [];

    const hasDockerfile = await this.fileExists('Dockerfile');
    if (hasDockerfile) hints.push('Dockerfile');
    const hasCompose = await this.fileExists('docker-compose.yml') || await this.fileExists('docker-compose.yaml');
    if (hasCompose) hints.push('docker-compose');
    const hasPackageJson = await this.fileExists('package.json');
    if (hasPackageJson) hints.push('package.json');
    const hasPyproject = await this.fileExists('pyproject.toml');
    if (hasPyproject) hints.push('pyproject.toml');
    const hasSetup = await this.fileExists('setup.py');
    if (hasSetup) hints.push('setup.py');
    const hasRequirements = await this.fileExists('requirements.txt');
    if (hasRequirements) hints.push('requirements.txt');
    const hasAppPy = await this.fileExists('app.py') || await this.fileExists('wsgi.py') || await this.fileExists('manage.py');
    if (hasAppPy) hints.push('app.py/wsgi.py/manage.py');

    // Priority: explicit containerization files
    if (hasDockerfile) {
      return {
        type: 'docker',
        confidence: 'high',
        rawHints: hints,
      };
    }

    if (hasCompose) {
      return {
        type: 'compose',
        confidence: 'high',
        rawHints: hints,
      };
    }

    // Node detection
    if (hasPackageJson) {
      // best-effort read scripts/main
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(this.root, 'package.json'), 'utf8'));
        const scripts = pkg.scripts || {};
        const main = pkg.main || scripts.start ? 'npm start' : undefined;
        const build = scripts.build ? 'npm run build' : undefined;
        const install = pkg.lockfileVersion || (await this.fileExists('package-lock.json')) ? 'npm ci' : 'npm install';
        const entrypoint = main || (pkg.main ? `node ${pkg.main}` : undefined);
        const nodeResult: any = {
          type: 'node',
          installCmd: install,
          ports: [],
          envFiles: (await this.fileExists('.env')) ? ['.env'] : [],
          buildSystem: 'npm',
          healthcheck: null,
          confidence: 'high',
          rawHints: hints,
        };
        if (entrypoint) nodeResult.entrypoint = entrypoint;
        if (build) nodeResult.buildCommand = build;
        if (scripts.start) nodeResult.startCommand = 'npm start';
        return nodeResult as DetectionResult;
      } catch (err) {
        // fall through to unknown with medium confidence
      }
    }

    // Python detection
    if (hasPyproject || hasSetup || hasRequirements || hasAppPy) {
      const hintsCopy = hints.slice();
      const py: any = {
        type: hasPyproject || hasSetup ? 'python-pypi' : 'python',
        ports: [],
        envFiles: (await this.fileExists('.env')) ? ['.env'] : [],
        buildSystem: hasPyproject ? 'pep517' : 'pip',
        healthcheck: null,
        confidence: hasPyproject || hasSetup ? 'high' : 'medium',
        rawHints: hintsCopy,
      };
      if (hasPyproject) py.installCmd = 'pip install .';
      else if (hasRequirements) py.installCmd = 'pip install -r requirements.txt';
      return py as DetectionResult;
    }

    return {
      type: 'unknown',
      confidence: 'low',
      rawHints: hints,
    } as DetectionResult;
  }

  /**
   * Detect with overrides: checks for deployer.container.json and env var DEPLOYER_FORCE_CONTAINER_TYPE
   */
  async detectWithOverrides(): Promise<DetectionResult> {
    const base = await this.detect();

    // Check env var override
    const forced = process.env['DEPLOYER_FORCE_CONTAINER_TYPE'];
    if (forced) {
      const forcedType = (forced as string).toLowerCase();
      if (['node', 'python-pypi', 'python', 'docker', 'compose'].includes(forcedType)) {
        base.rawHints = base.rawHints.concat([`env:DEPLOYER_FORCE_CONTAINER_TYPE=${forcedType}`]);
        base.type = forcedType as any;
        base.confidence = 'high';
        return base;
      }
    }

    // Check file override
    try {
      const raw = await fs.readFile(path.join(this.root, 'deployer.container.json'), 'utf8');
      const obj = JSON.parse(raw);
      if (obj && obj.type) {
        const t = String(obj.type).toLowerCase();
        if (['node', 'python-pypi', 'python', 'docker', 'compose'].includes(t)) {
          base.rawHints = base.rawHints.concat(['file:deployer.container.json']);
          base.type = t as any;
          base.confidence = 'high';
          if (obj.entrypoint) base.entrypoint = obj.entrypoint;
          return base;
        }
      }
    } catch (err) {
      // no override file, ignore
    }

    return base;
  }
}

export default AppDetectionService;
