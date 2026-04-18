import type { DeploymentStep } from '../orchestrator.js';
import { gitPullStep } from '../steps/git-pull.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { migrationUpStep } from '../steps/migration-up.step.js';
import { dockerBuildStep } from '../steps/docker-build.step.js';
import { dockerComposeUpStep } from '../steps/docker-compose-up.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';
import { preflightStep } from '../steps/preflight.step.js';

export const updateDockerPlan: DeploymentStep[] = [
  preflightStep,
  gitPullStep,
  envSetupStep,
  migrationUpStep,
  dockerBuildStep,
  dockerComposeUpStep,
  nginxConfigureStep,
];
