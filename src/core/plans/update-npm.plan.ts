import type { DeploymentStep } from '../orchestrator.js';
import { preflightStep } from '../steps/preflight.step.js';
import { npmInstallPackageStep } from '../steps/npm-install-package.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { migrationUpStep } from '../steps/migration-up.step.js';
import { pm2RestartStep } from '../steps/pm2-restart.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';

export const updateNpmPlan: DeploymentStep[] = [
  preflightStep,
  npmInstallPackageStep,
  envSetupStep,
  migrationUpStep,
  pm2RestartStep,
  nginxConfigureStep,
];
