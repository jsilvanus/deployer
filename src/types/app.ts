export type AppType = 'node' | 'docker';

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
  dbName?: string;
  port?: number;
}

export interface UpdateAppInput {
  branch?: string;
  domain?: string;
  nginxEnabled?: boolean;
  dbEnabled?: boolean;
  dbName?: string;
}

export interface CreateAppResult {
  app: App;
  apiKey: string; // returned only once at creation
}
