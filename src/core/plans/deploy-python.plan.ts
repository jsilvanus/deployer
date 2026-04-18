import type { DeploymentStep } from '../orchestrator.js';
import { preflightStep } from '../steps/preflight.step.js';
import { gitCloneStep } from '../steps/git-clone.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { databaseCreateStep } from '../steps/database-create.step.js';
import { migrationUpStep } from '../steps/migration-up.step.js';
import { pm2StartStep } from '../steps/pm2-start.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';

export const deployPythonPlan: DeploymentStep[] = [
  preflightStep,
  gitCloneStep,
  envSetupStep,
  databaseCreateStep,
  migrationUpStep,
  pm2StartStep,
  nginxConfigureStep,
];
