import type { DeploymentStep } from '../orchestrator.js';
import { composeWriteStep } from '../steps/compose-write.step.js';
import { dockerComposeUpStep } from '../steps/docker-compose-up.step.js';

export const deployComposePlan: DeploymentStep[] = [
  composeWriteStep,
  dockerComposeUpStep,
];
