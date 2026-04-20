import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { deployments, deploymentSnapshots } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { Deployment, DeploymentSnapshot, DeploymentOperation, TriggeredBy } from '../types/index.js';
import type { LastModifiedCache } from '../cache/last-modified.cache.js';
import metricsRegistry from './metrics.registry.js';

function rowToDeployment(row: typeof deployments.$inferSelect): Deployment {
  return {
    id:             row.id,
    appId:          row.appId,
    operation:      row.operation as DeploymentOperation,
    status:         row.status as Deployment['status'],
    triggeredBy:    row.triggeredBy as TriggeredBy,
    completedSteps: JSON.parse(row.completedSteps) as string[],
    createdAt:      row.createdAt,
    ...(row.gitCommitBefore != null ? { gitCommitBefore: row.gitCommitBefore } : {}),
    ...(row.gitCommitAfter  != null ? { gitCommitAfter:  row.gitCommitAfter  } : {}),
    ...(row.errorMessage    != null ? { errorMessage:    row.errorMessage    } : {}),
    ...(row.currentStep     != null ? { currentStep:     row.currentStep     } : {}),
    ...(row.finishedAt      != null ? { finishedAt:      row.finishedAt      } : {}),
  };
}

function rowToSnapshot(row: typeof deploymentSnapshots.$inferSelect): DeploymentSnapshot {
  return {
    id:           row.id,
    deploymentId: row.deploymentId,
    stepName:     row.stepName,
    stepOrder:    row.stepOrder,
    snapshotData: JSON.parse(row.snapshotData) as Record<string, unknown>,
    reversible:   row.reversible,
    reversed:     row.reversed,
    createdAt:    row.createdAt,
  };
}

export class DeploymentService {
  constructor(private db: Db, private cache?: LastModifiedCache) {}

  async create(
    appId: string,
    operation: DeploymentOperation,
    triggeredBy: TriggeredBy,
  ): Promise<Deployment> {
    const now = new Date();
    const [row] = await this.db
      .insert(deployments)
      .values({
        id:           randomUUID(),
        appId,
        operation,
        status:       'pending',
        triggeredBy,
        completedSteps: '[]',
        createdAt:    now,
      })
      .returning();
    if (!row) throw new Error('Insert failed');
    this.cache?.touch(`deployment:${row.id}`, now);
    this.cache?.touch(`app-deployments:${appId}`, now);
    // Increment deployment total counter for this operation
    try {
      metricsRegistry.incCounter('deployer_deployments_total', { operation });
    } catch {
      // non-fatal if metrics not available
    }
    return rowToDeployment(row);
  }

  async findById(id: string): Promise<Deployment | null> {
    const [row] = await this.db
      .select()
      .from(deployments)
      .where(eq(deployments.id, id))
      .limit(1);
    return row ? rowToDeployment(row) : null;
  }

  async updateStatus(
    id: string,
    updates: Partial<{
      status: Deployment['status'];
      currentStep: string | null;
      completedSteps: string[];
      errorMessage: string;
      gitCommitBefore: string;
      gitCommitAfter: string;
      finishedAt: Date;
    }>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    if (updates.status !== undefined) set['status'] = updates.status;
    if (updates.currentStep !== undefined) set['currentStep'] = updates.currentStep;
    if (updates.completedSteps !== undefined) set['completedSteps'] = JSON.stringify(updates.completedSteps);
    if (updates.errorMessage !== undefined) set['errorMessage'] = updates.errorMessage;
    if (updates.gitCommitBefore !== undefined) set['gitCommitBefore'] = updates.gitCommitBefore;
    if (updates.gitCommitAfter !== undefined) set['gitCommitAfter'] = updates.gitCommitAfter;
    if (updates.finishedAt !== undefined) set['finishedAt'] = updates.finishedAt;

    await this.db
      .update(deployments)
      .set(set)
      .where(eq(deployments.id, id));
    this.cache?.touch(`deployment:${id}`);
  }

  async hasRunningDeployment(appId: string): Promise<boolean> {
    const { and } = await import('drizzle-orm');
    const rows = await this.db
      .select({ id: deployments.id })
      .from(deployments)
      .where(and(eq(deployments.appId, appId), eq(deployments.status, 'running')))
      .limit(1);
    return rows.length > 0;
  }

  async getLastSuccessful(appId: string): Promise<Deployment | null> {
    const rows = await this.db
      .select()
      .from(deployments)
      .where(eq(deployments.appId, appId))
      .orderBy(desc(deployments.createdAt));
    const found = rows.find(r => r.status === 'success');
    return found ? rowToDeployment(found) : null;
  }

  async saveSnapshot(
    deploymentId: string,
    stepName: string,
    stepOrder: number,
    snapshotData: Record<string, unknown>,
    reversible: boolean,
  ): Promise<DeploymentSnapshot> {
    const [row] = await this.db
      .insert(deploymentSnapshots)
      .values({
        id:           randomUUID(),
        deploymentId,
        stepName,
        stepOrder,
        snapshotData: JSON.stringify(snapshotData),
        reversible,
        reversed:     false,
        createdAt:    new Date(),
      })
      .returning();
    if (!row) throw new Error('Insert failed');
    return rowToSnapshot(row);
  }

  async getSnapshots(deploymentId: string): Promise<DeploymentSnapshot[]> {
    const rows = await this.db
      .select()
      .from(deploymentSnapshots)
      .where(eq(deploymentSnapshots.deploymentId, deploymentId));
    return rows.map(rowToSnapshot);
  }

  async markSnapshotReversed(snapshotId: string): Promise<void> {
    await this.db
      .update(deploymentSnapshots)
      .set({ reversed: true })
      .where(eq(deploymentSnapshots.id, snapshotId));
  }
}
