import type { DeploymentStep } from './orchestrator.js';
import { gitCloneStep } from './steps/git-clone.step.js';
import { gitPullStep } from './steps/git-pull.step.js';
import { envSetupStep } from './steps/env-setup.step.js';
import { databaseCreateStep } from './steps/database-create.step.js';
import { migrationUpStep } from './steps/migration-up.step.js';
import { pm2StartStep } from './steps/pm2-start.step.js';
import { pm2RestartStep } from './steps/pm2-restart.step.js';
import { dockerBuildStep } from './steps/docker-build.step.js';
import { dockerComposeUpStep } from './steps/docker-compose-up.step.js';
import { composeWriteStep } from './steps/compose-write.step.js';
import { nginxConfigureStep } from './steps/nginx-configure.step.js';
import { npmBuildStep } from './steps/npm-build.step.js';

const steps: DeploymentStep[] = [
  gitCloneStep,
  gitPullStep,
  envSetupStep,
  databaseCreateStep,
  migrationUpStep,
  pm2StartStep,
  pm2RestartStep,
  dockerBuildStep,
  dockerComposeUpStep,
  composeWriteStep,
  nginxConfigureStep,
  npmBuildStep,
];

export const stepRegistry = new Map<string, DeploymentStep>(
  steps.map(s => [s.name, s]),
);
