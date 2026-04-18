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
import { Pm2Service } from '../services/pm2.service.js';
import { DockerService } from '../services/docker.service.js';
import { DeploymentOrchestrator } from '../core/orchestrator.js';
import { deployNodePlan } from '../core/plans/deploy-node.plan.js';
import { updateNodePlan } from '../core/plans/update-node.plan.js';
import { deployDockerPlan } from '../core/plans/deploy-docker.plan.js';
import { updateDockerPlan } from '../core/plans/update-docker.plan.js';

export function createMcpServer(db: Db, config: Config, logger: AnyLogger): McpServer {
  const server = new McpServer({
    name: 'deployer',
    version: VERSION,
  });

  const appSvc = new AppService(db, config.envEncryptionKey);
  const deploymentSvc = new DeploymentService(db);
  const migSvc = new MigrationService(logger);
  const pm2Svc = new Pm2Service(logger);
  const dockerSvc = new DockerService(logger);
  const orchestrator = new DeploymentOrchestrator(deploymentSvc, logger, config, db);

  // ── list_apps ──────────────────────────────────────────────────────────────
  server.tool(
    'list_apps',
    'List all registered applications and their API key prefixes',
    { status: z.string().optional().describe('Filter by type: node or docker') },
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
      name:          z.string().min(1).describe('App name (lowercase, hyphens allowed)'),
      type:          z.enum(['node', 'docker']).describe('App runtime type'),
      repoUrl:       z.string().describe('Git repository URL'),
      branch:        z.string().default('main').describe('Git branch'),
      deployPath:    z.string().describe('Absolute path on server, e.g. /srv/apps/myapp'),
      dockerCompose: z.boolean().default(false),
      nginxEnabled:  z.boolean().default(false),
      domain:        z.string().optional().describe('Domain for nginx reverse proxy'),
      dbEnabled:     z.boolean().default(false),
      dbName:        z.string().optional(),
      port:          z.number().int().min(1).max(65535).optional().describe('App port for nginx proxy'),
    },
    async (input) => {
      const createInput: import('../types/index.js').CreateAppInput = {
        name:          input.name,
        type:          input.type,
        repoUrl:       input.repoUrl,
        branch:        input.branch,
        deployPath:    input.deployPath,
        dockerCompose: input.dockerCompose,
        nginxEnabled:  input.nginxEnabled,
        dbEnabled:     input.dbEnabled,
        ...(input.domain  !== undefined ? { domain:  input.domain  } : {}),
        ...(input.dbName  !== undefined ? { dbName:  input.dbName  } : {}),
        ...(input.port    !== undefined ? { port:    input.port    } : {}),
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

  // ── get_app_status ─────────────────────────────────────────────────────────
  server.tool(
    'get_app_status',
    'Get live runtime status for an application (PM2 or Docker)',
    { app_name: z.string().describe('App name') },
    async ({ app_name }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      let status: unknown;
      if (app.type === 'node') {
        status = await pm2Svc.status(app.name);
      } else {
        status = await dockerSvc.containerStatus(app.name);
      }
      return { content: [{ type: 'text', text: JSON.stringify({ app: app.name, type: app.type, status }, null, 2) }] };
    },
  );

  // ── deploy_app ─────────────────────────────────────────────────────────────
  server.tool(
    'deploy_app',
    'Deploy an application for the first time (git clone, build, migrate, start)',
    {
      app_name:     z.string().describe('App name (must already be registered)'),
      env_vars:     z.record(z.string()).optional().describe('Environment variables to write to .env'),
      allow_db_drop: z.boolean().default(false).describe('Allow dropping DB on rollback'),
    },
    async ({ app_name, env_vars, allow_db_drop }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      if (await deploymentSvc.hasRunningDeployment(app.id)) {
        return { content: [{ type: 'text', text: 'A deployment is already running for this app' }] };
      }

      const deployment = await deploymentSvc.create(app.id, 'deploy', 'mcp');
      const plan = app.type === 'docker' ? deployDockerPlan : deployNodePlan;
      const options: Record<string, unknown> = {
        allowDbDrop: allow_db_drop,
        envVars: env_vars ?? {},
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
            status: 'accepted',
            deployment_id: deployment.id,
            message: 'Deployment started. Poll get_deployment to track progress.',
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
    },
    async ({ app_name, env_vars }) => {
      const app = await appSvc.findByName(app_name);
      if (!app) return { content: [{ type: 'text', text: `App "${app_name}" not found` }] };

      if (await deploymentSvc.hasRunningDeployment(app.id)) {
        return { content: [{ type: 'text', text: 'A deployment is already running for this app' }] };
      }

      const deployment = await deploymentSvc.create(app.id, 'update', 'mcp');
      const plan = app.type === 'docker' ? updateDockerPlan : updateNodePlan;
      const options: Record<string, unknown> = { envVars: env_vars ?? {} };

      setImmediate(() => {
        orchestrator.run(app, deployment.id, plan, options).catch((err: unknown) => {
          logger.error({ err, deploymentId: deployment.id }, 'MCP update failed');
        });
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'accepted',
            deployment_id: deployment.id,
            message: 'Update started. Poll get_deployment to track progress.',
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
            status: 'accepted',
            deployment_id: rollback.id,
            target_deployment_id: targetDeploymentId,
            message: 'Rollback started. Poll get_deployment to track progress.',
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
      const msg = deleted ? `Deleted "${key}" from "${app_name}"` : `Key "${key}" not found for "${app_name}"`;
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

  return server;
}
