import { setTimeout as wait } from 'node:timers/promises';
import { ScheduleService } from './schedule.service.js';
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
    const deploymentSvc = new DeploymentService(this.db);
    const appSvc = new AppService(this.db, this.config.envEncryptionKey);
    const orchestrator = new DeploymentOrchestrator(deploymentSvc, this.logger, this.config, this.db);

    while (!this.stopped) {
      try {
        const due = await scheduleSvc.listForDue(new Date());
        for (const s of due) {
          this.logger.info({ scheduleId: s.id }, 'Running scheduled task');
          const app = await appSvc.findById(s.appId);
          if (!app) continue;

          // Only implement deploy/update/stop/delete mapping for now
          if (s.type === 'deploy' || s.type === 'update') {
            if (await deploymentSvc.hasRunningDeployment(app.id)) continue;
            const deployment = await deploymentSvc.create(app.id, s.type === 'deploy' ? 'deploy' : 'update', 'scheduler');
            const plan = app.type === 'compose' ? deployComposePlan
                       : app.type === 'docker'  ? deployDockerPlan
                       : app.type === 'python'  ? deployPythonPlan
                       : app.type === 'npm'     ? deployNpmPlan
                       : app.type === 'pypi'    ? deployPypiPlan
                       : app.type === 'image'   ? deployImagePlan
                       : deployNodePlan;
            setImmediate(() => orchestrator.run(app, deployment.id, plan, {}).catch((err: unknown) => this.logger.error({ err, deploymentId: deployment.id }, 'Scheduled run failed')));
            // update nextRun for this schedule
            try {
              await scheduleSvc.updateNextRun(s.id);
            } catch (err) {
              this.logger.warn({ err, scheduleId: s.id }, 'Failed to update nextRun for schedule');
            }
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
