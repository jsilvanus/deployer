import { execa } from 'execa';
import type { DeploymentStep } from '../orchestrator.js';
import type { StepContext } from '../../types/index.js';
import { NginxService } from '../../services/nginx.service.js';

export const preflightStep: DeploymentStep = {
  name: 'preflight',
  reversible: false,

  async captureSnapshot(): Promise<Record<string, unknown>> {
    return {};
  },

  async execute(ctx: StepContext): Promise<void> {
    await checkNginxConflict(ctx);
    await checkPortConflict(ctx);
  },

  async rollback(): Promise<void> {
    // nothing to undo — this step only reads
  },
};

async function checkNginxConflict(ctx: StepContext): Promise<void> {
  if (!ctx.app.nginxEnabled || !ctx.app.domain) return;

  const nginx = new NginxService(ctx.logger);
  const conflict = await nginx.findExternalConflict(
    ctx.app.domain,
    ctx.app.nginxLocation,
    ctx.app.name,
  );

  if (!conflict) return;

  if (conflict.ownedByDeployer) {
    // Another deployer app claims this domain+location — DB check should have
    // caught this already, but guard here too in case of data inconsistency.
    throw new Error(
      `nginx conflict: domain "${ctx.app.domain}" location "${ctx.app.nginxLocation}" ` +
      `is already configured for deployer app "${conflict.ownerAppName}" (file: ${conflict.file})`,
    );
  }

  throw new Error(
    `nginx conflict: domain "${ctx.app.domain}" location "${ctx.app.nginxLocation}" ` +
    `is already claimed by an external nginx config (file: ${conflict.file}). ` +
    `Remove or update that config before deploying this app.`,
  );
}

async function checkPortConflict(ctx: StepContext): Promise<void> {
  const port = ctx.app.port;
  if (port == null) return;

  // On update/rollback the app itself already holds the port — that is expected.
  if (ctx.deployment.operation !== 'deploy') return;

  let stdout = '';
  try {
    ({ stdout } = await execa('ss', ['-tlnp']));
  } catch {
    ctx.logger.warn('preflight: could not run ss — skipping port liveness check');
    return;
  }

  // Match lines where the local address ends with :<port> followed by whitespace.
  const portRe = new RegExp(`:${port}\\s`);
  const match = stdout.split('\n').find(l => portRe.test(l));
  if (!match) return;

  // Extract the process name from the users:((...)) field if present
  const procMatch = match.match(/users:\(\("([^"]+)"/);
  const procName = procMatch ? procMatch[1] : 'unknown process';

  throw new Error(
    `Port ${port} is already bound by "${procName}". ` +
    `Stop that process or choose a different port before deploying.`,
  );
}
