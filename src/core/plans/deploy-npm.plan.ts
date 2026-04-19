import type { DeploymentStep } from '../orchestrator.js';
import { preflightStep } from '../steps/preflight.step.js';
import { npmInstallPackageStep } from '../steps/npm-install-package.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { databaseCreateStep } from '../steps/database-create.step.js';
import { migrationUpStep } from '../steps/migration-up.step.js';
import { pm2StartStep } from '../steps/pm2-start.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';

export const deployNpmPlan: DeploymentStep[] = [
  preflightStep,
  npmInstallPackageStep,
  envSetupStep,
  databaseCreateStep,
  migrationUpStep,
  pm2StartStep,
  nginxConfigureStep,
];
