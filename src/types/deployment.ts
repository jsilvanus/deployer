import type { App } from './app.js';
import type { AnyLogger } from './logger.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';

export type DeploymentOperation = 'deploy' | 'update' | 'rollback';
export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back';
export type TriggeredBy = 'api' | 'mcp';

export interface Deployment {
  id: string;
  appId: string;
  operation: DeploymentOperation;
  status: DeploymentStatus;
  triggeredBy: TriggeredBy;
  gitCommitBefore?: string;
  gitCommitAfter?: string;
  errorMessage?: string;
  currentStep?: string;
  completedSteps: string[];
  createdAt: Date;
  finishedAt?: Date;
}

export interface DeploymentSnapshot {
  id: string;
  deploymentId: string;
  stepName: string;
  stepOrder: number;
  snapshotData: Record<string, unknown>;
  reversible: boolean;
  reversed: boolean;
  createdAt: Date;
}

export interface StepContext {
  app: App;
  deployment: Deployment;
  logger: AnyLogger;
  config: Config;
  db: Db;
  options?: Record<string, unknown>;
}
