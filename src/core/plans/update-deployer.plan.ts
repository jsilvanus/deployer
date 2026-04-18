import type { DeploymentStep } from '../orchestrator.js';
import { preflightStep } from '../steps/preflight.step.js';
import { gitPullStep } from '../steps/git-pull.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { npmBuildStep } from '../steps/npm-build.step.js';
import { migrationUpStep } from '../steps/migration-up.step.js';
import { pm2RestartStep } from '../steps/pm2-restart.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';

export const updateDeployerPlan: DeploymentStep[] = [
  preflightStep,
  gitPullStep,
  envSetupStep,
  npmBuildStep,
  migrationUpStep,
  pm2RestartStep,
  nginxConfigureStep,
];
