import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { execa } from 'execa';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { VERSION } from '../config/version.js';
import type { Db } from '../db/client.js';
import type { Config } from '../config.js';
import type { AnyLogger } from '../types/logger.js';
import { AppService } from '../services/app.service.js';
import { AppEnvService } from '../services/app-env.service.js';
import { DeploymentService } from '../services/deployment.service.js';
import { MigrationService } from '../services/migration.service.js';
import { MetricsService } from '../services/metrics.service.js';
import { Pm2Service } from '../services/pm2.service.js';
import { DockerService } from '../services/docker.service.js';
import { DeploymentOrchestrator } from '../core/orchestrator.js';
import { deployNodePlan } from '../core/plans/deploy-node.plan.js';
import { updateNodePlan } from '../core/plans/update-node.plan.js';
import { deployDockerPlan } from '../core/plans/deploy-docker.plan.js';
import { updateDockerPlan } from '../core/plans/update-docker.plan.js';
import { deployComposePlan } from '../core/plans/deploy-compose.plan.js';
import { updateComposePlan } from '../core/plans/update-compose.plan.js';
import { deployPythonPlan } from '../core/plans/deploy-python.plan.js';
import { updatePythonPlan } from '../core/plans/update-python.plan.js';
import { updateDeployerPlan } from '../core/plans/update-deployer.plan.js';
import { deployNpmPlan } from '../core/plans/deploy-npm.plan.js';
import { updateNpmPlan } from '../core/plans/update-npm.plan.js';
import { deployPypiPlan } from '../core/plans/deploy-pypi.plan.js';
import { updatePypiPlan } from '../core/plans/update-pypi.plan.js';
import { deployImagePlan } from '../core/plans/deploy-image.plan.js';
import { updateImagePlan } from '../core/plans/update-image.plan.js';
import { TraefikService, type TraefikMode } from '../services/traefik.service.js';
import { resolve } from 'node:path';

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

export function createMcpServer(db: Db, config: Config, logger: AnyLogger): McpServer {
  const server = new McpServer({
    name: 'deployer',
    version: VERSION,
  });

  const appSvc = new AppService(db, config.envEncryptionKey);
  const deploymentSvc = new DeploymentService(db);
  const migSvc = new MigrationService(logger);
  const metricsSvc = new MetricsService(db, logger);
  const pm2Svc = new Pm2Service(logger);
  const dockerSvc = new DockerService(logger);
  const orchestrator = new DeploymentOrchestrator(deploymentSvc, logger, config, db);

  // ── list_apps ──────────────────────────────────────────────────────────────
  server.tool(
    'list_apps',
    'List all registered applications and their API key prefixes',
    { status: z.string().optional().describe('Filter by type: node, python, docker, compose, npm, pypi, or image') },
    async ({ status }) => {
      const apps = await appSvc.list();
      const filtered = status ? apps.filter(a => a.type === status) : apps;
      return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
    },
  );

  // ── register_app ───────────────────────────────────────────────────────────
  server.tool(
    'register_app',
    'Register a new application (does not deploy it)',
    {
      name:           z.string().min(1).describe('App name (lowercase, hyphens allowed)'),
      type:           z.enum(['node', 'python', 'docker', 'compose', 'npm', 'pypi', 'image']).describe('App runtime type'),
      repoUrl:        z.string().optional().describe('Git repository URL (required for node, python, docker)'),
      branch:         z.string().default('main').describe('Git branch'),
      deployPath:     z.string().describe('Absolute path on server, e.g. /srv/apps/myapp'),
      composeContent: z.string().optional().describe('Docker Compose file content (required for compose type)'),
      primaryService: z.string().optional().describe('Primary service name in compose file'),
      dockerCompose:  z.boolean().default(false),
      nginxEnabled:   z.boolean().default(false),
      nginxLocation:  z.string().optional().describe('Nginx location block path, e.g. /'),
      domain:         z.string().optional().describe('Domain for nginx reverse proxy'),
      dbEnabled:      z.boolean().default(false),
      dbName:         z.string().optional(),
      port:           z.number().int().min(1).max(65535).optional().describe('App port for nginx proxy'),
      packageName:      z.string().optional().describe('Package/image name: npm (@scope/pkg), PyPI (gunicorn), or Docker image (nginx, ghcr.io/org/app)'),
      packageVersion:   z.string().optional().describe('Version/tag: npm (latest, 1.2.3), PyPI (23.0.0), or Docker image tag (latest, sha-abc123)'),
      registryUrl:      z.string().optional().describe('Registry/index URL: npm (https://npm.pkg.github.com), PyPI index (https://pypi.example.com/simple/), Docker registry hostname (ghcr.io), or omit for git'),
      registryToken:    z.string().optional().describe('Auth token/password for the registry (stored encrypted, never returned)'),
      registryUsername: z.string().optional().describe('Username for the registry (stored encrypted, never returned)'),
    },
    async (input) => {
      const createInput: import('../types/index.js').CreateAppInput = {
        name:           input.name,
        type:           input.type,
        branch:         input.branch,
        deployPath:     input.deployPath,
        dockerCompose:  input.dockerCompose,
        nginxEnabled:   input.nginxEnabled,
        dbEnabled:      input.dbEnabled,
        ...(input.repoUrl        !== undefined ? { repoUrl:        input.repoUrl        } : {}),
        ...(input.composeContent !== undefined ? { composeContent: input.composeContent } : {}),
        ...(input.primaryService !== undefined ? { primaryService: input.primaryService } : {}),
        ...(input.nginxLocation  !== undefined ? { nginxLocation:  input.nginxLocation  } : {}),
        ...(input.domain         !== undefined ? { domain:         input.domain         } : {}),
        ...(input.dbName         !== undefined ? { dbName:         input.dbName         } : {}),
        ...(input.port           !== undefined ? { port:           input.port           } : {}),
        ...(input.packageName      !== undefined ? { packageName:      input.packageName      } : {}),
        ...(input.packageVersion   !== undefined ? { packageVersion:   input.packageVersion   } : {}),
        ...(input.registryUrl      !== undefined ? { registryUrl:      input.registryUrl      } : {}),
        ...(input.registryToken    !== undefined ? { registryToken:    input.registryToken    } : {}),
        ...(input.registryUsername !== undefined ? { registryUsername: input.registryUsername } : {}),
      };
      const result = await appSvc.create(createInput);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            app: result.app,
            apiKey: result.apiKey,
            warning: 'Save this API key — it will not be shown again',
          }, null, 2),
        }],
      };
    },
  );

  // ── update_app_config ──────────────────────────────────────────────────────
  server.tool(
    'update_app_config',
    'Update configuration for a registered application (branch, domain, nginx settings, etc.)',
    {
      app_name:       z.string().describe('App name'),
      branch:         z.string().optional().describe('Git branch'),
      domain:         z.string().optional().describe('Domain for nginx reverse proxy'),
      nginxEnabled:   z.boolean().optional().describe('Enable nginx reverse proxy'),
      nginxLocation:  z.string().optional().describe('Nginx location block path'),
      dbEnabled:      z.boolean().optional().describe('Enable database'),
      dbName:         z.string().optional().describe('Database name'),
      composeContent:   z.string().optional().describe('Updated Docker Compose file content'),
      primaryService:   z.string().optional().describe('Primary service name in compose file'),
      packageVersion:   z.string().optional().describe('New package/image version or tag to deploy'),
      registryUrl:      z.string().optional().describe('Registry/index URL'),
      registryToken:    z.string().optional().describe('Auth token/password for the registry (stored encrypted)'),
      registryUsername: z.string().optional().describe('Username for the registry (stored encrypted)'),
    },
    async ({ app_name, ...updates }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      const updateInput: import('../types/index.js').UpdateAppInput = {};
      if (updates.branch           !== undefined) updateInput.branch           = updates.branch;
      if (updates.domain           !== undefined) updateInput.domain           = updates.domain;
      if (updates.nginxEnabled     !== undefined) updateInput.nginxEnabled     = updates.nginxEnabled;
      if (updates.nginxLocation    !== undefined) updateInput.nginxLocation    = updates.nginxLocation;
      if (updates.dbEnabled        !== undefined) updateInput.dbEnabled        = updates.dbEnabled;
      if (updates.dbName           !== undefined) updateInput.dbName           = updates.dbName;
      if (updates.composeContent   !== undefined) updateInput.composeContent   = updates.composeContent;
      if (updates.primaryService   !== undefined) updateInput.primaryService   = updates.primaryService;
      if (updates.packageVersion   !== undefined) updateInput.packageVersion   = updates.packageVersion;
      if (updates.registryUrl      !== undefined) updateInput.registryUrl      = updates.registryUrl;
      if (updates.registryToken    !== undefined) updateInput.registryToken    = updates.registryToken;
      if (updates.registryUsername !== undefined) updateInput.registryUsername = updates.registryUsername;

      const updated = await appSvc.update(app.id, updateInput);
      if (!updated) return { content: [{ type: 'text', text: 'Update failed' }] };
      return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
    },
  );

  // ── delete_app ─────────────────────────────────────────────────────────────
  server.tool(
    'delete_app',
    'Delete a registered application and all its stored env vars (does not stop running processes)',
    { app_name: z.string().describe('App name') },
    async ({ app_name }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };
      await appSvc.delete(app.id);
      return { content: [{ type: 'text', text: `App "${app_name}" deleted` }] };
    },
  );

  // ── get_app_status ─────────────────────────────────────────────────────────
  server.tool(
    'get_app_status',
    'Get live runtime status for an application (PM2 or Docker)',
    { app_name: z.string().describe('App name') },
    async ({ app_name }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      let status: unknown;
      if (app.type === 'node' || app.type === 'python') {
        const info = await pm2Svc.status(app.name);
        status = {
          status:  info?.status ?? 'not_found',
          pid:     info?.pid    ?? null,
          memory:  info?.memory ?? null,
          cpu:     info?.cpu    ?? null,
          uptime:  info?.uptime ?? null,
        };
      } else {
        const [ps, stats] = await Promise.all([
          dockerSvc.composePsStatus(app.deployPath),
          dockerSvc.composeStats(app.deployPath),
        ]);
        const statsMap = new Map(stats.map(s => [s.name, s]));
        status = {
          status:   ps.status,
          services: ps.services.map(svc => ({ ...svc, ...statsMap.get(svc.name) })),
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ app: app.name, type: app.type, status }, null, 2),
        }],
      };
    },
  );

  // ── get_app_logs ───────────────────────────────────────────────────────────
  server.tool(
    'get_app_logs',
    'Tail recent log output for an application (PM2 stdout/stderr or Docker Compose logs)',
    {
      app_name:    z.string().describe('App name'),
      lines:       z.number().int().min(1).max(5000).default(100).describe('Number of lines to return'),
      include_stderr: z.boolean().default(true).describe('Include stderr output (PM2 apps only)'),
    },
    async ({ app_name, lines, include_stderr }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      if (app.type === 'node' || app.type === 'python') {
        const [stdout, stderr] = await Promise.all([
          tailLines(pm2LogPath(app.name, 'out'), lines),
          include_stderr ? tailLines(pm2LogPath(app.name, 'err'), lines) : Promise.resolve(''),
        ]);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ app: app.name, type: app.type, stdout, stderr }, null, 2),
          }],
        };
      } else {
        let stdout = '';
        try {
          const result = await execa(
            'docker', ['compose', 'logs', '--tail', String(lines), '--no-color'],
            { cwd: app.deployPath },
          );
          stdout = result.stdout;
        } catch {
          // ignore — return empty
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ app: app.name, type: app.type, stdout, stderr: '' }, null, 2),
          }],
        };
      }
    },
  );

  // ── get_app_metrics ────────────────────────────────────────────────────────
  server.tool(
    'get_app_metrics',
    'Query historical CPU/memory/status metrics for an application',
    {
      app_name: z.string().describe('App name'),
      from:     z.string().optional().describe('ISO 8601 start time (default: 1 hour ago)'),
      to:       z.string().optional().describe('ISO 8601 end time (default: now)'),
    },
    async ({ app_name, from, to }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      const toDate   = to   ? new Date(to)   : new Date();
      const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 60 * 60 * 1000);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return { content: [{ type: 'text', text: 'Invalid from/to date — use ISO 8601 format' }] };
      }

      const points = await metricsSvc.query(app.id, fromDate, toDate);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            app:   app.name,
            from:  fromDate.toISOString(),
            to:    toDate.toISOString(),
            points,
          }, null, 2),
        }],
      };
    },
  );

  // ── deploy_app ─────────────────────────────────────────────────────────────
  server.tool(
    'deploy_app',
    'Deploy an application for the first time (git clone, build, migrate, start)',
    {
      app_name:      z.string().describe('App name (must already be registered)'),
      env_vars:      z.record(z.string()).optional().describe('Environment variables to write to .env'),
      allow_db_drop: z.boolean().default(false).describe('Allow dropping DB on rollback'),
    },
    async ({ app_name, env_vars, allow_db_drop }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      if (await deploymentSvc.hasRunningDeployment(app.id)) {
        return { content: [{ type: 'text', text: 'A deployment is already running for this app' }] };
      }

      const deployment = await deploymentSvc.create(app.id, 'deploy', 'mcp');
      const plan = app.type === 'compose' ? deployComposePlan
                 : app.type === 'docker'  ? deployDockerPlan
                 : app.type === 'python'  ? deployPythonPlan
                 : app.type === 'npm'     ? deployNpmPlan
                 : app.type === 'pypi'    ? deployPypiPlan
                 : app.type === 'image'   ? deployImagePlan
                 : deployNodePlan;
      const options: Record<string, unknown> = {
        allowDbDrop: allow_db_drop,
        envVars:     env_vars ?? {},
      };

      setImmediate(() => {
        orchestrator.run(app, deployment.id, plan, options).catch((err: unknown) => {
          logger.error({ err, deploymentId: deployment.id }, 'MCP deploy failed');
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status:        'accepted',
            deployment_id: deployment.id,
            message:       'Deployment started. Poll get_deployment to track progress.',
          }, null, 2),
        }],
      };
    },
  );

  // ── update_app ─────────────────────────────────────────────────────────────
  server.tool(
    'update_app',
    'Update an existing application (git pull, migrate, restart)',
    {
      app_name:      z.string().describe('App name'),
      env_vars:      z.record(z.string()).optional().describe('Environment variable overrides'),
      force_rebuild: z.boolean().default(false).describe('Force docker rebuild even if no code changes'),
      allow_db_drop: z.boolean().default(false).describe('Allow dropping DB on rollback'),
    },
    async ({ app_name, env_vars, allow_db_drop }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      if (await deploymentSvc.hasRunningDeployment(app.id)) {
        return { content: [{ type: 'text', text: 'A deployment is already running for this app' }] };
      }

      const deployment = await deploymentSvc.create(app.id, 'update', 'mcp');
      const plan = app.type === 'compose' ? updateComposePlan
                 : app.type === 'docker'  ? updateDockerPlan
                 : app.type === 'python'  ? updatePythonPlan
                 : app.type === 'npm'     ? updateNpmPlan
                 : app.type === 'pypi'    ? updatePypiPlan
                 : app.type === 'image'   ? updateImagePlan
                 : updateNodePlan;
      const options: Record<string, unknown> = {
        allowDbDrop: allow_db_drop,
        envVars:     env_vars ?? {},
      };

      setImmediate(() => {
        orchestrator.run(app, deployment.id, plan, options).catch((err: unknown) => {
          logger.error({ err, deploymentId: deployment.id }, 'MCP update failed');
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status:        'accepted',
            deployment_id: deployment.id,
            message:       'Update started. Poll get_deployment to track progress.',
          }, null, 2),
        }],
      };
    },
  );

  // ── rollback_app ───────────────────────────────────────────────────────────
  server.tool(
    'rollback_app',
    'Roll back the most recent successful deployment for an app, or a specific deployment',
    {
      app_name:      z.string().optional().describe('App name (rolls back most recent successful deployment)'),
      deployment_id: z.string().optional().describe('Specific deployment ID to roll back'),
    },
    async ({ app_name, deployment_id }) => {
      let targetDeploymentId: string;
      let appId: string;

      if (deployment_id) {
        const target = await deploymentSvc.findById(deployment_id);
        if (!target) return { content: [{ type: 'text', text: `Deployment "${deployment_id}" not found` }] };
        if (target.status !== 'success') {
          return { content: [{ type: 'text', text: 'Can only roll back a successful deployment' }] };
        }
        targetDeploymentId = target.id;
        appId = target.appId;
      } else if (app_name) {
        const app = await appSvc.findByName(app_name);
        if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };
        const last = await deploymentSvc.getLastSuccessful(app.id);
        if (!last) return { content: [{ type: 'text', text: 'No successful deployment to roll back' }] };
        targetDeploymentId = last.id;
        appId = app.id;
      } else {
        return { content: [{ type: 'text', text: 'Provide either app_name or deployment_id' }] };
      }

      const app = await appSvc.findById(appId);
      if (!app) return { content: [{ type: 'text', text: 'App not found' }] };

      const rollback = await deploymentSvc.create(appId, 'rollback', 'mcp');

      setImmediate(() => {
        orchestrator.rollbackDeployment(app, rollback.id, targetDeploymentId).catch((err: unknown) => {
          logger.error({ err, rollbackId: rollback.id }, 'MCP rollback failed');
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status:               'accepted',
            deployment_id:        rollback.id,
            target_deployment_id: targetDeploymentId,
            message:              'Rollback started. Poll get_deployment to track progress.',
          }, null, 2),
        }],
      };
    },
  );

  // ── get_deployment ─────────────────────────────────────────────────────────
  server.tool(
    'get_deployment',
    'Get status and details of a deployment by ID',
    { deployment_id: z.string().describe('Deployment ID') },
    async ({ deployment_id }) => {
      const d = await deploymentSvc.findById(deployment_id);
      if (!d) return { content: [{ type: 'text', text: `Deployment "${deployment_id}" not found` }] };
      return { content: [{ type: 'text', text: JSON.stringify(d, null, 2) }] };
    },
  );

  // ── list_deployments ───────────────────────────────────────────────────────
  server.tool(
    'list_deployments',
    'List deployment history, optionally filtered by app',
    {
      app_name: z.string().optional().describe('Filter by app name'),
      limit:    z.number().int().min(1).max(100).default(20),
    },
    async ({ app_name, limit }) => {
      let deps;
      if (app_name) {
        const app = await appSvc.findByName(app_name);
        if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };
        deps = await appSvc.listDeployments(app.id, limit);
      } else {
        deps = await appSvc.listAllDeployments(limit);
      }
      return { content: [{ type: 'text', text: JSON.stringify(deps, null, 2) }] };
    },
  );

  // ── get_deployment_snapshots ───────────────────────────────────────────────
  server.tool(
    'get_deployment_snapshots',
    'Get all step snapshots for a deployment (useful for inspecting what rollback would revert)',
    { deployment_id: z.string().describe('Deployment ID') },
    async ({ deployment_id }) => {
      const snapshots = await deploymentSvc.getSnapshots(deployment_id);
      return { content: [{ type: 'text', text: JSON.stringify(snapshots, null, 2) }] };
    },
  );

  // ── get_app_env_keys ───────────────────────────────────────────────────────
  server.tool(
    'get_app_env_keys',
    'List stored per-app env var keys (values are not returned)',
    { app_name: z.string().describe('App name') },
    async ({ app_name }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };
      const envSvc = new AppEnvService(db, config.envEncryptionKey);
      const keys = await envSvc.listKeys(app.id);
      return { content: [{ type: 'text', text: JSON.stringify({ app: app_name, keys }, null, 2) }] };
    },
  );

  // ── set_app_env ────────────────────────────────────────────────────────────
  server.tool(
    'set_app_env',
    'Set one or more per-app env vars (encrypted at rest, injected into .env on next deploy/update)',
    {
      app_name: z.string().describe('App name'),
      vars:     z.record(z.string()).describe('Key-value pairs to store'),
    },
    async ({ app_name, vars }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };
      const envSvc = new AppEnvService(db, config.envEncryptionKey);
      await envSvc.setMany(app.id, vars);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ app: app_name, stored: Object.keys(vars) }, null, 2),
        }],
      };
    },
  );

  // ── delete_app_env ─────────────────────────────────────────────────────────
  server.tool(
    'delete_app_env',
    'Delete a stored per-app env var by key',
    {
      app_name: z.string().describe('App name'),
      key:      z.string().describe('Env var key to delete'),
    },
    async ({ app_name, key }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };
      const envSvc = new AppEnvService(db, config.envEncryptionKey);
      const deleted = await envSvc.delete(app.id, key);
      const msg = deleted
        ? `Deleted "${key}" from "${app_name}"`
        : `Key "${key}" not found for "${app_name}"`;
      return { content: [{ type: 'text', text: msg }] };
    },
  );

  // ── run_migrations ─────────────────────────────────────────────────────────
  server.tool(
    'run_migrations',
    'Manually run database migrations for an app',
    {
      app_name:  z.string().describe('App name'),
      direction: z.enum(['up', 'down']).describe('Migration direction'),
    },
    async ({ app_name, direction }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      const runner = await migSvc.detectRunner(app.deployPath);
      if (!runner) {
        return { content: [{ type: 'text', text: 'No migration runner detected in app directory' }] };
      }

      let result: unknown;
      if (direction === 'up') {
        result = await migSvc.runUp(app.deployPath, runner);
      } else {
        await migSvc.runDown(app.deployPath, runner, []);
        result = 'done';
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ runner, direction, result }, null, 2),
        }],
      };
    },
  );

  // ── setup_traefik ──────────────────────────────────────────────────────────
  server.tool(
    'setup_traefik',
    'Install and configure Traefik as the reverse proxy for docker/compose apps. Auto-detects whether nginx is present to choose standalone vs behind-nginx mode.',
    {
      mode:       z.enum(['auto', 'standalone', 'behind-nginx']).default('auto'),
      acme_email: z.string().optional().describe('Email for Let\'s Encrypt (standalone mode)'),
      port:       z.number().int().min(1024).max(65535).default(8080).describe('Traefik HTTP port'),
    },
    async ({ mode: requestedMode, acme_email, port }) => {
      const docker = new DockerService(logger);
      await docker.networkCreate('deployer-internal');

      const traefikSvc = new TraefikService();
      const mode: TraefikMode = requestedMode === 'auto'
        ? await traefikSvc.detectMode()
        : requestedMode as TraefikMode;

      const composeContent = traefikSvc.generateCompose(mode, {
        ...(acme_email !== undefined && { acmeEmail: acme_email }),
        port,
      });
      const deployPath = resolve(
        config.allowedDeployPaths.split(',')[0]?.trim() ?? '/srv/apps',
        'traefik',
      );

      const existing = await appSvc.findByName('traefik');
      let app;
      let isNew: boolean;
      if (!existing) {
        const result = await appSvc.create({ name: 'traefik', type: 'compose', deployPath, composeContent });
        app = result.app;
        isNew = true;
      } else {
        app = (await appSvc.update(existing.id, { composeContent })) ?? existing;
        isNew = false;
      }

      if (await deploymentSvc.hasRunningDeployment(app.id)) {
        return { content: [{ type: 'text', text: 'A Traefik deployment is already running' }] };
      }

      const envSvc = new AppEnvService(db, config.envEncryptionKey);
      await envSvc.set(app.id, '_TRAEFIK_MODE', mode);

      const plan = isNew ? deployComposePlan : updateComposePlan;
      const deployment = await deploymentSvc.create(app.id, isNew ? 'deploy' : 'update', 'mcp');
      setImmediate(() => {
        orchestrator.run(app, deployment.id, plan, {}).catch((err: unknown) => {
          logger.error({ err, deploymentId: deployment.id }, 'MCP Traefik setup failed');
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status:        'accepted',
            deployment_id: deployment.id,
            mode,
            message:       `Traefik ${isNew ? 'deployment' : 'update'} started (${mode}). Poll get_deployment to track progress.`,
          }, null, 2),
        }],
      };
    },
  );

  // ── self_register ──────────────────────────────────────────────────────────
  server.tool(
    'self_register',
    'Register the deployer itself as a managed app (enables self_update). Auto-detects repo URL from git remote if not supplied.',
    {
      name:         z.string().default('deployer').describe('App name to register under'),
      repo_url:     z.string().optional().describe('Git repo URL (auto-detected from git remote if omitted)'),
      branch:       z.string().default('main'),
      deploy_path:  z.string().optional().describe('Deploy path (defaults to current working directory)'),
      package_name: z.string().optional().describe('npm package name if npm-installed (e.g. @jsilvanus/deployer)'),
    },
    async ({ name, repo_url, branch, deploy_path, package_name }) => {
      const existing = await appSvc.findByName(name);
      if (existing) {
        return { content: [{ type: 'text', text: JSON.stringify({ app: existing, message: 'Already registered' }, null, 2) }] };
      }

      const deployPath = resolve(deploy_path ?? process.cwd());
      let repoUrl = repo_url;
      if (!repoUrl) {
        try {
          const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: deployPath });
          repoUrl = stdout.trim();
        } catch { /* no git remote — register as npm type */ }
      }

      let result;
      if (repoUrl) {
        result = await appSvc.create({ name, type: 'node', repoUrl, branch, deployPath });
      } else {
        const packageName = package_name ?? '@jsilvanus/deployer';
        result = await appSvc.create({ name, type: 'npm', deployPath, packageName, packageVersion: 'latest' });
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            app:     result.app,
            apiKey:  result.apiKey,
            warning: 'Save this API key — it will not be shown again',
            message: 'Deployer self-registered. Use self_update to update it.',
          }, null, 2),
        }],
      };
    },
  );

  // ── self_update ────────────────────────────────────────────────────────────
  server.tool(
    'self_update',
    'Update the deployer itself: git pull + build (git-installed) or npm install (npm-installed), run migrations, pm2 restart.',
    {
      name: z.string().default('deployer').describe('App name used when self-registering'),
    },
    async ({ name }) => {
      const app = await appSvc.findByName(name);
      if (!app) {
        return { content: [{ type: 'text', text: `App "${name}" not found — call self_register first` }] };
      }
      if (await deploymentSvc.hasRunningDeployment(app.id)) {
        return { content: [{ type: 'text', text: 'A deployment is already running for this app' }] };
      }

      const deployment = await deploymentSvc.create(app.id, 'update', 'mcp');
      const selfUpdatePlan = app.type === 'npm' ? updateNpmPlan : updateDeployerPlan;
      setImmediate(() => {
        orchestrator.run(app, deployment.id, selfUpdatePlan, {}).catch((err: unknown) => {
          logger.error({ err, deploymentId: deployment.id }, 'MCP self-update failed');
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status:        'accepted',
            deployment_id: deployment.id,
            message:       'Self-update started — deployer will restart after build. Poll get_deployment to track progress.',
          }, null, 2),
        }],
      };
    },
  );

  return server;
}
