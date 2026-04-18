import { z } from 'zod';

const configSchema = z.object({
  port:                  z.coerce.number().int().min(1).max(65535).default(3000),
  adminToken:            z.string().min(16, 'DEPLOYER_ADMIN_TOKEN must be at least 16 chars'),
  envEncryptionKey:      z.string().regex(/^[0-9a-fA-F]{64}$/, 'DEPLOYER_ENV_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  allowedDeployPaths:    z.string().default('/srv/apps'),
  dbPath:                z.string().default('./deployer.db'),
  pgHost:                z.string().default('localhost'),
  pgPort:                z.coerce.number().int().min(1).max(65535).default(5432),
  pgUser:                z.string().default('postgres'),
  pgPassword:            z.string().default(''),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse({
    port:               process.env['DEPLOYER_PORT'],
    adminToken:         process.env['DEPLOYER_ADMIN_TOKEN'],
    envEncryptionKey:   process.env['DEPLOYER_ENV_ENCRYPTION_KEY'],
    allowedDeployPaths: process.env['DEPLOYER_ALLOWED_DEPLOY_PATHS'],
    dbPath:             process.env['DEPLOYER_DB_PATH'],
    pgHost:             process.env['DEPLOYER_PG_HOST'],
    pgPort:             process.env['DEPLOYER_PG_PORT'],
    pgUser:             process.env['DEPLOYER_PG_USER'],
    pgPassword:         process.env['DEPLOYER_PG_PASSWORD'],
  });

  if (!result.success) {
    const msgs = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Configuration error:\n${msgs}`);
  }

  return result.data;
}
