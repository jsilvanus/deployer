import type { DeploymentStep } from '../orchestrator.js';
import { gitCloneStep } from '../steps/git-clone.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { databaseCreateStep } from '../steps/database-create.step.js';
import { migrationUpStep } from '../steps/migration-up.step.js';
import { dockerBuildStep } from '../steps/docker-build.step.js';
import { dockerComposeUpStep } from '../steps/docker-compose-up.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';

export const deployDockerPlan: DeploymentStep[] = [
  gitCloneStep,
  envSetupStep,
  databaseCreateStep,
  migrationUpStep,
  dockerBuildStep,
  dockerComposeUpStep,
  nginxConfigureStep,
];
