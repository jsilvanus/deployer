import type { DeploymentStep } from '../orchestrator.js';
import { preflightStep } from '../steps/preflight.step.js';
import { imagePullStep } from '../steps/image-pull.step.js';
import { envSetupStep } from '../steps/env-setup.step.js';
import { imageComposeWriteStep } from '../steps/image-compose-write.step.js';
import { dockerComposeUpStep } from '../steps/docker-compose-up.step.js';
import { nginxConfigureStep } from '../steps/nginx-configure.step.js';

export const deployImagePlan: DeploymentStep[] = [
  preflightStep,
  imagePullStep,
  envSetupStep,
  imageComposeWriteStep,
  dockerComposeUpStep,
  nginxConfigureStep,
];
