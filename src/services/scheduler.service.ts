import { setTimeout as wait } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { ScheduleService } from './schedule.service.js';
import { ScheduleLockService } from './schedule-lock.service.js';
import { DeploymentService } from './deployment.service.js';
import { AppService } from './app.service.js';
import { DeploymentOrchestrator } from '../core/orchestrator.js';
import { deployComposePlan } from '../core/plans/deploy-compose.plan.js';
import { deployDockerPlan } from '../core/plans/deploy-docker.plan.js';
import { deployNodePlan } from '../core/plans/deploy-node.plan.js';
import { deployPythonPlan } from '../core/plans/deploy-python.plan.js';
import { deployNpmPlan } from '../core/plans/deploy-npm.plan.js';
import { deployPypiPlan } from '../core/plans/deploy-pypi.plan.js';
import { deployImagePlan } from '../core/plans/deploy-image.plan.js';
import type { Db } from '../db/client.js';
import type { Config } from '../config.js';
import { scheduleRuns } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import RunExecutor from './run-executor.service.js';

export class SchedulerService {
  private stopped = false;

  constructor(private db: Db, private config: Config, private logger: any) {}

  start() {
    this.logger.info('Starting scheduler service');
    this.loop();
  }

  stop() {
    this.stopped = true;
  }

  private async loop() {
    const scheduleSvc = new ScheduleService(this.db);
    const lockSvc = new ScheduleLockService(this.db);
    const deploymentSvc = new DeploymentService(this.db);
    const appSvc = new AppService(this.db, this.config.envEncryptionKey);
    const orchestrator = new DeploymentOrchestrator(deploymentSvc, this.logger, this.config, this.db);

    while (!this.stopped) {
      try {
        const due = await scheduleSvc.listForDue(new Date());
        // Reuse a single RunExecutor for this poll to avoid repeated allocations
        const runExecutor = new RunExecutor(this.logger);
        for (const s of due) {
          this.logger.info({ scheduleId: s.id, type: s.type }, 'Evaluating scheduled task');
          // Acquire lock to avoid duplicate execution across instances
          const lock = await lockSvc.tryAcquire(s.id);
          if (!lock.acquired) {
            this.logger.info({ scheduleId: s.id }, 'Skipping — lock held by another instance');
            continue;
          }
          const owner = lock.owner;

          // record run start
          const runId = await this.db.insert(scheduleRuns).values({
            id: randomUUID(),
            scheduleId: s.id,
            status: 'running',
            startedAt: new Date(),
            details: '{}',
          }).then((r: any) => r[0]?.id ?? null).catch(() => null);

          try {
            const app = s.appId ? await appSvc.findById(s.appId) : null;
            if (s.type === 'deploy' || s.type === 'update') {
              if (!app) throw new Error('App not found');
              if (await deploymentSvc.hasRunningDeployment(app.id)) throw new Error('Deployment already running');
              const deployment = await deploymentSvc.create(app.id, s.type === 'deploy' ? 'deploy' : 'update', 'mcp');
              const plan = app.type === 'compose' ? deployComposePlan
                         : app.type === 'docker'  ? deployDockerPlan
                         : app.type === 'python'  ? deployPythonPlan
                         : app.type === 'npm'     ? deployNpmPlan
                         : app.type === 'pypi'    ? deployPypiPlan
                         : app.type === 'image'   ? deployImagePlan
                         : deployNodePlan;
              setImmediate(() => orchestrator.run(app, deployment.id, plan, {}).catch((err: unknown) => this.logger.error({ err, deploymentId: deployment.id }, 'Scheduled run failed')));
            } else if (s.type === 'stop') {
              if (!app) throw new Error('App not found');
              if (app.type === 'node' || app.type === 'python') {
                const pm2 = new (await import('./pm2.service.js')).Pm2Service(this.logger);
                await pm2.stop(app.name);
              } else {
                const docker = new (await import('./docker.service.js')).DockerService(this.logger);
                await docker.composeDown(app.deployPath).catch(() => {});
              }
            } else if (s.type === 'delete') {
              if (!app) throw new Error('App not found');
              // stop then delete app record and files
              if (app.type === 'node' || app.type === 'python') {
                const pm2 = new (await import('./pm2.service.js')).Pm2Service(this.logger);
                await pm2.delete(app.name).catch(() => {});
              } else {
                const docker = new (await import('./docker.service.js')).DockerService(this.logger);
                await docker.composeDown(app.deployPath).catch(() => {});
              }
              // delete files
              try { await (await import('node:fs/promises')).rm(app.deployPath, { recursive: true, force: true }); } catch {}
              await (await import('./app.service.js')).AppService.prototype.delete.call(new (await import('./app.service.js')).AppService(this.db, this.config.envEncryptionKey), app.id);
            } else if (s.type === 'self-update') {
              // trigger deployer self-update via orchestrator if registered
              const appName = 'deployer';
              const app = await appSvc.findByName(appName);
              if (app) {
                const deployment = await deploymentSvc.create(app.id, 'update', 'mcp');
                const selfUpdatePlan = app.type === 'npm' ? (await import('../core/plans/update-npm.plan.js')).updateNpmPlan : (await import('../core/plans/update-deployer.plan.js')).updateDeployerPlan;
                setImmediate(() => orchestrator.run(app, deployment.id, selfUpdatePlan, {}).catch((err: unknown) => this.logger.error({ err, deploymentId: deployment.id }, 'Scheduled self-update failed')));
              }
            } else if (s.type === 'self-shutdown') {
              const svc = new (await import('./self-shutdown.service.js')).SelfShutdownService(this.db, this.config, this.logger);
              await svc.execute({ deleteInstalled: false, initiatedBy: 'scheduler' });
            } else if (s.type === 'run') {
              const payload = typeof s.payload === 'string' ? JSON.parse(s.payload) : (s.payload ?? {});
              const runSpec = payload.runSpec ?? (app ? (app as any).runSpec : null);
              if (!runSpec) throw new Error('No runSpec provided for run schedule');
              const cwd = app?.deployPath ?? undefined;
              const res = await runExecutor.execute(runSpec as any, { cwd });
              if (!res.success) throw new Error(res.error ?? 'run failed');
            }

            // mark run success
            if (runId) await this.db.update(scheduleRuns).set({ status: 'success', finishedAt: new Date(), details: '{}' }).where(eq(scheduleRuns.id, runId));

          } catch (err) {
            this.logger.error({ err, scheduleId: s.id }, 'Scheduled task failed');
            if (runId) await this.db.update(scheduleRuns).set({ status: 'failed', finishedAt: new Date(), details: String(err) }).where(eq(scheduleRuns.id, runId));
          } finally {
            // update nextRun for this schedule
            try {
              await scheduleSvc.updateNextRun(s.id);
            } catch (err) {
              this.logger.warn({ err, scheduleId: s.id }, 'Failed to update nextRun for schedule');
            }
            // release lock
            try { if (owner) await lockSvc.release(s.id, owner); } catch {}
          }
        }
      } catch (err) {
        this.logger.error({ err }, 'Scheduler loop error');
      }

      // Sleep 30s between polls
      await wait(30_000);
    }
  }
}

export default SchedulerService;
