import { sqliteTable, text, integer, uniqueIndex, real } from 'drizzle-orm/sqlite-core';

export const apps = sqliteTable('apps', {
  id:             text('id').primaryKey(),
  name:           text('name').notNull().unique(),
  type:           text('type').notNull(), // 'node' | 'docker'
  repoUrl:        text('repo_url').notNull(),
  branch:         text('branch').notNull().default('main'),
  deployPath:     text('deploy_path').notNull(),
  dockerCompose:  integer('docker_compose', { mode: 'boolean' }).notNull().default(false),
  nginxEnabled:   integer('nginx_enabled', { mode: 'boolean' }).notNull().default(false),
  nginxLocation:  text('nginx_location').notNull().default('/'),
  domain:         text('domain'),
  dbEnabled:      integer('db_enabled', { mode: 'boolean' }).notNull().default(false),
  dbType:         text('db_type').notNull().default('postgres'),
  dbName:         text('db_name'),
  pgHost:         text('pg_host'),
  pgPort:         integer('pg_port'),
  pgAdminUser:    text('pg_admin_user'),
  primaryService: text('primary_service'),
  internalNetwork: integer('internal_network', { mode: 'boolean' }).notNull().default(true),
  apiKeyHash:     text('api_key_hash').notNull(),
  apiKeyPrefix:   text('api_key_prefix').notNull(),
  port:            integer('port'),
  packageName:     text('package_name'),
  packageVersion:  text('package_version').notNull(),
  runSpec:         text('run_spec').notNull().default('{}'),
  registryUrl:     text('registry_url'),
  lastModified:    integer('last_modified', { mode: 'timestamp' }),
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:       integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const deployments = sqliteTable('deployments', {
  id:               text('id').primaryKey(),
  appId:            text('app_id').notNull().references(() => apps.id),
  operation:        text('operation').notNull(), // 'deploy' | 'update' | 'rollback'
  status:           text('status').notNull(),    // 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'
  triggeredBy:      text('triggered_by').notNull(), // 'api' | 'mcp'
  gitCommitBefore:  text('git_commit_before'),
  gitCommitAfter:   text('git_commit_after'),
  errorMessage:     text('error_message'),
  currentStep:      text('current_step'),
  completedSteps:   text('completed_steps').notNull().default('[]'), // JSON array
  createdAt:        integer('created_at', { mode: 'timestamp' }).notNull(),
  finishedAt:       integer('finished_at', { mode: 'timestamp' }),
});

export const deploymentSnapshots = sqliteTable('deployment_snapshots', {
  id:            text('id').primaryKey(),
  deploymentId:  text('deployment_id').notNull().references(() => deployments.id),
  stepName:      text('step_name').notNull(),
  stepOrder:     integer('step_order').notNull(),
  snapshotData:  text('snapshot_data').notNull(), // JSON blob
  reversible:    integer('reversible', { mode: 'boolean' }).notNull(),
  reversed:      integer('reversed', { mode: 'boolean' }).notNull().default(false),
  createdAt:     integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const envFiles = sqliteTable('env_files', {
  id:               text('id').primaryKey(),
  appId:            text('app_id').notNull().references(() => apps.id),
  deploymentId:     text('deployment_id').references(() => deployments.id),
  encryptedContent: text('encrypted_content').notNull(), // AES-256-GCM, base64
  contentChecksum:  text('content_checksum').notNull(),  // SHA-256 of plaintext
  iv:               text('iv').notNull(),                // base64 AES IV
  createdAt:        integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type AppRow = typeof apps.$inferSelect;
export type NewAppRow = typeof apps.$inferInsert;
export type DeploymentRow = typeof deployments.$inferSelect;
export type NewDeploymentRow = typeof deployments.$inferInsert;
export type SnapshotRow = typeof deploymentSnapshots.$inferSelect;
export type NewSnapshotRow = typeof deploymentSnapshots.$inferInsert;
export type EnvFileRow = typeof envFiles.$inferSelect;
export type NewEnvFileRow = typeof envFiles.$inferInsert;

export const appEnvVars = sqliteTable('app_env_vars', {
  id:               text('id').primaryKey(),
  appId:            text('app_id').notNull().references(() => apps.id),
  key:              text('key').notNull(),
  encryptedValue:   text('encrypted_value').notNull(), // AES-256-GCM, base64
  iv:               text('iv').notNull(),               // base64 AES IV
  createdAt:        integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:        integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => [
  uniqueIndex('app_env_vars_app_id_key_unique').on(t.appId, t.key),
]);

export type AppEnvVarRow = typeof appEnvVars.$inferSelect;
export type NewAppEnvVarRow = typeof appEnvVars.$inferInsert;

export const appMetrics = sqliteTable('app_metrics', {
  id:        text('id').primaryKey(),
  appId:     text('app_id').notNull().references(() => apps.id),
  timestamp: integer('timestamp').notNull(), // Unix seconds
  status:    text('status').notNull(),
  cpu:       real('cpu'),
  memoryMb:  real('memory_mb'),
});

export const schedules = sqliteTable('schedules', {
  id:           text('id').primaryKey(),
  appId:        text('app_id').references(() => apps.id),
  type:         text('type').notNull(), // deploy | stop | delete | update | self-update | self-shutdown
  payload:      text('payload').notNull().default('{}'), // JSON
  cron:         text('cron').notNull(),
  timezone:     text('timezone').notNull().default('UTC'),
  nextRun:      integer('next_run', { mode: 'timestamp' }),
  enabled:      integer('enabled', { mode: 'boolean' }).notNull().default(true),
  retryPolicy:  text('retry_policy').notNull().default('{}'),
  createdBy:    text('created_by'),
  createdAt:    integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:    integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const shutdownLogs = sqliteTable('shutdown_logs', {
  id:            text('id').primaryKey(),
  initiatedBy:   text('initiated_by'),
  dryRun:        integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  deleted:       integer('deleted', { mode: 'boolean' }).notNull().default(false),
  details:       text('details').notNull(),
  createdAt:     integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const scheduleRuns = sqliteTable('schedule_runs', {
  id:         text('id').primaryKey(),
  scheduleId: text('schedule_id').notNull().references(() => schedules.id),
  status:     text('status').notNull(), // pending | running | success | failed
  startedAt:  integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  details:    text('details').notNull(),
});

export const scheduleLocks = sqliteTable('schedule_locks', {
  scheduleId: text('schedule_id').primaryKey().references(() => schedules.id),
  owner:      text('owner').notNull(),
  expiresAt:  integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const requestLogs = sqliteTable('request_logs', {
  id:         text('id').primaryKey(),
  method:     text('method').notNull(),
  path:       text('path').notNull(),
  headers:    text('headers').notNull(),
  body:       text('body'),
  statusCode: integer('status_code'),
  tokenInfo:  text('token_info'),
  createdAt:  integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type AppMetricRow = typeof appMetrics.$inferSelect;
export type NewAppMetricRow = typeof appMetrics.$inferInsert;
