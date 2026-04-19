export type AppType = 'node' | 'python' | 'docker' | 'compose' | 'npm';
export type DbType = 'postgres' | 'sqlite';

export interface App {
  id: string;
  name: string;
  type: AppType;
  repoUrl: string;
  branch: string;
  deployPath: string;
  dockerCompose: boolean;
  nginxEnabled: boolean;
  nginxLocation: string;
  domain?: string;
  dbEnabled: boolean;
  dbType: DbType;
  dbName?: string;
  pgHost?: string;
  pgPort?: number;
  pgAdminUser?: string;
  primaryService?: string;
  internalNetwork: boolean;
  apiKeyPrefix: string;
  port?: number;
  packageName?: string;
  packageVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppInput {
  name: string;
  type: AppType;
  repoUrl?: string;
  branch?: string;
  composeContent?: string;
  deployPath: string;
  dockerCompose?: boolean;
  nginxEnabled?: boolean;
  nginxLocation?: string;
  domain?: string;
  dbEnabled?: boolean;
  dbType?: DbType;
  dbName?: string;
  pgHost?: string;
  pgPort?: number;
  pgAdminUser?: string;
  pgAdminPassword?: string;
  primaryService?: string;
  internalNetwork?: boolean;
  port?: number;
  packageName?: string;
  packageVersion?: string;
}

export interface UpdateAppInput {
  composeContent?: string;
  branch?: string;
  domain?: string;
  nginxEnabled?: boolean;
  nginxLocation?: string;
  dbEnabled?: boolean;
  dbType?: DbType;
  dbName?: string;
  pgHost?: string;
  pgPort?: number;
  pgAdminUser?: string;
  pgAdminPassword?: string;
  primaryService?: string;
  internalNetwork?: boolean;
  packageVersion?: string;
}

export interface CreateAppResult {
  app: App;
  apiKey: string;             // returned only once at creation
  generatedDbPassword?: string; // set when dbEnabled — returned only once
}
