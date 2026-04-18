export interface GitCloneSnapshotData {
  repoPath: string;
}

export interface GitPullSnapshotData {
  repoPath: string;
  commitHashBefore: string;
  branch: string;
}

export interface EnvSetupSnapshotData {
  envFilePath: string;
  envFileExistedBefore: boolean;
  envFileChecksumBefore?: string;
  encryptedBackupId?: string; // FK to env_files
}

export interface DatabaseCreateSnapshotData {
  dbName: string;
  dbUser: string;
  created: boolean;
}

export interface MigrationUpSnapshotData {
  runner: 'drizzle' | 'prisma' | 'sql';
  appliedMigrations: string[];
}

export interface Pm2StartSnapshotData {
  processName: string;
}

export interface Pm2RestartSnapshotData {
  processName: string;
  statusBefore: string;
  commitHashBefore: string;
  repoPath: string;
}

export interface DockerBuildSnapshotData {
  imageName: string;
  newImageTag: string;
  previousImageTag?: string;
}

export interface DockerComposeUpSnapshotData {
  composePath: string;
  serviceNames: string[];
}

export interface NginxConfigureSnapshotData {
  configPath: string;
  configExistedBefore: boolean;
  configContentBefore?: string;
  symlinkPath: string;
}
