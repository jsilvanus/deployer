import type { AnyLogger } from '../types/logger.js';
import type { App, Deployment, StepContext } from '../types/index.js';
import type { DeploymentService } from '../services/deployment.service.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import metricsRegistry from '../services/metrics.registry.js';

export interface DeploymentStep {
  name: string;
  reversible: boolean;
  captureSnapshot(ctx: StepContext): Promise<Record<string, unknown>>;
  execute(ctx: StepContext): Promise<void>;
  rollback(ctx: StepContext, snapshot: Record<string, unknown>): Promise<void>;
}

export class DeploymentOrchestrator {
  constructor(
    private deploymentSvc: DeploymentService,
    private logger: AnyLogger,
    private config: Config,
    private db: Db,
  ) {}

  async run(
    app: App,
    deploymentId: string,
    plan: DeploymentStep[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    const deployment = await this.deploymentSvc.findById(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const ctx: StepContext = {
      app,
      deployment,
      logger: this.logger.child({ deploymentId, appId: app.id }),
      config: this.config,
      db: this.db,
      ...(options !== undefined ? { options } : {}),
    };

    await this.deploymentSvc.updateStatus(deploymentId, { status: 'running' });
    // mark active and start duration timer
    try {
      const gauge = metricsRegistry.getOrCreateGauge('deployer_deployments_active', 'Number of running deployments');
      gauge.inc();
    } catch {
      /* ignore */
    }
    let endTimer: (() => void) | null = null;
    try {
      const hist = metricsRegistry.getOrCreateHistogram('deployer_deployment_duration_seconds', 'Deployment duration seconds', ['app', 'operation']);
      endTimer = hist.startTimer({ app: app.name, operation: deployment.operation });
    } catch {
      endTimer = null;
    }

    const commitBefore = await this.tryGetCommit(app);
    if (commitBefore) {
      await this.deploymentSvc.updateStatus(deploymentId, { gitCommitBefore: commitBefore });
    }

    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      if (!step) continue;

      ctx.deployment = (await this.deploymentSvc.findById(deploymentId))!;

      ctx.logger.info({ step: step.name, stepIndex: i }, 'executing step');
      await this.deploymentSvc.updateStatus(deploymentId, { currentStep: step.name });

      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = await step.captureSnapshot(ctx);
      } catch (err) {
        ctx.logger.warn({ step: step.name, err }, 'captureSnapshot failed; proceeding without snapshot');
      }

      await this.deploymentSvc.saveSnapshot(
        deploymentId,
        step.name,
        i,
        snapshot,
        step.reversible,
      );

      try {
        // step-level timing
        let stepEnd: (() => void) | null = null;
        try {
          stepEnd = metricsRegistry.getOrCreateHistogram('deployer_step_duration_seconds', 'Step duration seconds', ['step', 'app']).startTimer({ step: step.name, app: app.name });
        } catch {
          stepEnd = null;
        }

        await step.execute(ctx);
        const prev = ctx.deployment.completedSteps;
        await this.deploymentSvc.updateStatus(deploymentId, {
          completedSteps: [...prev, step.name],
        });
        try { if (stepEnd) stepEnd(); } catch {}
        ctx.logger.info({ step: step.name }, 'step completed');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error({ step: step.name, err }, 'step failed; rolling back');

        await this.deploymentSvc.updateStatus(deploymentId, {
          status: 'failed',
          errorMessage: `Step "${step.name}" failed: ${message}`,
          currentStep: null,
          finishedAt: new Date(),
        });

        try { metricsRegistry.incCounter('deployer_deployments_failed_total', { operation: deployment.operation }); } catch {}
        try { metricsRegistry.incCounter('deployer_step_failures_total', { step: step.name, app: app.name }); } catch {}
        try { const g = metricsRegistry.getOrCreateGauge('deployer_deployments_active', 'Number of running deployments'); g.dec(); } catch {}
        try { if (endTimer) endTimer(); } catch {}

        await this.rollbackFromStep(ctx, deploymentId, i);
        return;
      }
    }

    const commitAfter = await this.tryGetCommit(app);
    await this.deploymentSvc.updateStatus(deploymentId, {
      status: 'success',
      currentStep: null,
      finishedAt: new Date(),
      ...(commitAfter != null ? { gitCommitAfter: commitAfter } : {}),
    });

    try { const g = metricsRegistry.getOrCreateGauge('deployer_deployments_active', 'Number of running deployments'); g.dec(); } catch {}
    try { if (endTimer) endTimer(); } catch {}

    ctx.logger.info('deployment completed successfully');
  }

  async rollbackDeployment(
    app: App,
    rollbackDeploymentId: string,
    targetDeploymentId: string,
    options?: Record<string, unknown>,
  ): Promise<void> {
    const target = await this.deploymentSvc.findById(targetDeploymentId);
    if (!target) throw new Error(`Target deployment ${targetDeploymentId} not found`);

    const rollbackDeployment = (await this.deploymentSvc.findById(rollbackDeploymentId))!;
    const ctx: StepContext = {
      app,
      deployment: rollbackDeployment,
      config: this.config,
      db: this.db,
      logger: this.logger.child({
        deploymentId: rollbackDeploymentId,
        targetDeploymentId,
        appId: app.id,
      }),
      ...(options !== undefined ? { options } : {}),
    };

    await this.deploymentSvc.updateStatus(rollbackDeploymentId, { status: 'running' });
    try { const gauge = metricsRegistry.getOrCreateGauge('deployer_deployments_active', 'Number of running deployments'); gauge.inc(); } catch {}
    let rollbackEnd: (() => void) | null = null;
    try { rollbackEnd = metricsRegistry.getOrCreateHistogram('deployer_deployment_duration_seconds', 'Deployment duration seconds', ['app','operation']).startTimer({ app: app.name, operation: 'rollback' }); } catch {}

    const snapshots = await this.deploymentSvc.getSnapshots(targetDeploymentId);
    const reversible = snapshots
      .filter(s => s.reversible && !s.reversed)
      .sort((a, b) => b.stepOrder - a.stepOrder);

    for (const snapshot of reversible) {
      ctx.logger.info({ step: snapshot.stepName }, 'rolling back step');
      await this.deploymentSvc.updateStatus(rollbackDeploymentId, {
        currentStep: `rollback:${snapshot.stepName}`,
      });

      try {
        const step = await this.resolveStep(snapshot.stepName);
        if (step) {
          await step.rollback(ctx, snapshot.snapshotData);
          await this.deploymentSvc.markSnapshotReversed(snapshot.id);
        } else {
          ctx.logger.warn({ step: snapshot.stepName }, 'step handler not found; skipping rollback');
        }
      } catch (err) {
        ctx.logger.error({ step: snapshot.stepName, err }, 'rollback step failed; continuing');
      }
    }

    await this.deploymentSvc.updateStatus(rollbackDeploymentId, {
      status: 'rolled_back',
      currentStep: null,
      finishedAt: new Date(),
    });

    try { const g = metricsRegistry.getOrCreateGauge('deployer_deployments_active', 'Number of running deployments'); g.dec(); } catch {}
    try { if (rollbackEnd) rollbackEnd(); } catch {}

    ctx.logger.info('rollback completed');
  }

  private async rollbackFromStep(
    ctx: StepContext,
    deploymentId: string,
    fromStepIndex: number,
  ): Promise<void> {
    const snapshots = await this.deploymentSvc.getSnapshots(deploymentId);
    const reversible = snapshots
      .filter(s => s.reversible && s.stepOrder <= fromStepIndex)
      .sort((a, b) => b.stepOrder - a.stepOrder);

    for (const snapshot of reversible) {
      ctx.logger.info({ step: snapshot.stepName }, 'auto-rolling back step');
      try {
        const step = await this.resolveStep(snapshot.stepName);
        if (step) {
          await step.rollback(ctx, snapshot.snapshotData);
          await this.deploymentSvc.markSnapshotReversed(snapshot.id);
        }
      } catch (err) {
        ctx.logger.error({ step: snapshot.stepName, err }, 'auto-rollback step failed; continuing');
      }
    }

    await this.deploymentSvc.updateStatus(deploymentId, { status: 'rolled_back' });
  }

  private async tryGetCommit(app: App): Promise<string | null> {
    try {
      const { GitService } = await import('../services/git.service.js');
      const git = new GitService(this.logger);
      return await git.getCurrentHash(app.deployPath);
    } catch {
      return null;
    }
  }

  // Step registry — lazily imported to avoid circular deps
  private async resolveStep(stepName: string): Promise<DeploymentStep | null> {
    const { stepRegistry } = await import('./step-registry.js');
    return stepRegistry.get(stepName) ?? null;
  }
}
