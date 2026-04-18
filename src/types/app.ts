export type AppType = 'node' | 'docker';
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
  domain?: string;
  dbEnabled: boolean;
  dbType: DbType;
  dbName?: string;
  apiKeyPrefix: string;
  port?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppInput {
  name: string;
  type: AppType;
  repoUrl: string;
  branch?: string;
  deployPath: string;
  dockerCompose?: boolean;
  nginxEnabled?: boolean;
  domain?: string;
  dbEnabled?: boolean;
  dbType?: DbType;
  dbName?: string;
  port?: number;
}

export interface UpdateAppInput {
  branch?: string;
  domain?: string;
  nginxEnabled?: boolean;
  dbEnabled?: boolean;
  dbType?: DbType;
  dbName?: string;
}

export interface CreateAppResult {
  app: App;
  apiKey: string;             // returned only once at creation
  generatedDbPassword?: string; // set when dbEnabled — returned only once
}
