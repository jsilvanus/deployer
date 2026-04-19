import { randomBytes, createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { eq, desc, and, ne } from 'drizzle-orm';
import { apps, deployments } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { App, CreateAppInput, UpdateAppInput, CreateAppResult } from '../types/index.js';
import type { Deployment } from '../types/index.js';
import { AppEnvService } from './app-env.service.js';
import { ConflictError } from '../errors.js';
import type { LastModifiedCache } from '../cache/last-modified.cache.js';

function rowToApp(row: typeof apps.$inferSelect): App {
  return {
    id:            row.id,
    name:          row.name,
    type:          row.type as App['type'],
    repoUrl:       row.repoUrl,
    branch:        row.branch,
    deployPath:    row.deployPath,
    dockerCompose: row.dockerCompose,
    nginxEnabled:  row.nginxEnabled,
    nginxLocation: row.nginxLocation,
    dbEnabled:     row.dbEnabled,
    dbType:        (row.dbType ?? 'postgres') as App['dbType'],
    apiKeyPrefix:  row.apiKeyPrefix,
    createdAt:     row.createdAt,
    updatedAt:     row.updatedAt,
    ...(row.domain      != null ? { domain:      row.domain      } : {}),
    ...(row.dbName      != null ? { dbName:      row.dbName      } : {}),
    ...(row.pgHost         != null ? { pgHost:         row.pgHost         } : {}),
    ...(row.pgPort         != null ? { pgPort:         row.pgPort         } : {}),
    ...(row.pgAdminUser    != null ? { pgAdminUser:    row.pgAdminUser    } : {}),
    ...(row.primaryService != null ? { primaryService: row.primaryService } : {}),
    internalNetwork: row.internalNetwork,
    ...(row.port           != null ? { port:           row.port           } : {}),
    ...(row.packageName    != null ? { packageName:    row.packageName    } : {}),
    ...(row.packageVersion != null ? { packageVersion: row.packageVersion } : {}),
    ...(row.registryUrl    != null ? { registryUrl:    row.registryUrl    } : {}),
  };
}

function rowToDeployment(row: typeof deployments.$inferSelect): Deployment {
  return {
    id:             row.id,
    appId:          row.appId,
    operation:      row.operation as Deployment['operation'],
    status:         row.status as Deployment['status'],
    triggeredBy:    row.triggeredBy as Deployment['triggeredBy'],
    completedSteps: JSON.parse(row.completedSteps) as string[],
    createdAt:      row.createdAt,
    ...(row.gitCommitBefore != null ? { gitCommitBefore: row.gitCommitBefore } : {}),
    ...(row.gitCommitAfter  != null ? { gitCommitAfter:  row.gitCommitAfter  } : {}),
    ...(row.errorMessage    != null ? { errorMessage:    row.errorMessage    } : {}),
    ...(row.currentStep     != null ? { currentStep:     row.currentStep     } : {}),
    ...(row.finishedAt      != null ? { finishedAt:      row.finishedAt      } : {}),
  };
}

export class AppService {
  constructor(
    private db: Db,
    private encryptionKeyHex: string,
    private cache?: LastModifiedCache,
  ) {}

  async create(input: CreateAppInput): Promise<CreateAppResult> {
    await this.assertNginxUnique(input.domain, input.nginxLocation ?? '/', input.nginxEnabled ?? false, null);
    await this.assertPortUnique(input.port, null);

    const apiKey = randomBytes(32).toString('hex');
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    const apiKeyPrefix = apiKey.slice(0, 8);
    const now = new Date();

    const [row] = await this.db
      .insert(apps)
      .values({
        id:            randomUUID(),
        name:          input.name,
        type:          input.type,
        repoUrl:       input.repoUrl ?? '',
        branch:        input.branch ?? 'main',
        deployPath:    input.deployPath,
        dockerCompose: input.dockerCompose ?? false,
        nginxEnabled:  input.nginxEnabled ?? false,
        nginxLocation: input.nginxLocation ?? '/',
        domain:        input.domain,
        dbEnabled:     input.dbEnabled ?? false,
        dbType:        input.dbType ?? 'postgres',
        dbName:        input.dbName,
        pgHost:         input.pgHost,
        pgPort:         input.pgPort,
        pgAdminUser:    input.pgAdminUser,
        primaryService:  input.primaryService ?? (input.type === 'image' ? 'app' : undefined),
        internalNetwork: (input.type === 'node' || input.type === 'python' || input.type === 'npm' || input.type === 'pypi')
          ? false
          : (input.internalNetwork ?? true),
        port:            input.port,
        packageName:     input.packageName,
        packageVersion:  input.packageVersion,
        registryUrl:     input.registryUrl,
        apiKeyHash,
        apiKeyPrefix,
        createdAt:     now,
        updatedAt:     now,
      })
      .returning();

    if (!row) throw new Error('Insert failed');

    const app = rowToApp(row);
    this.cache?.touch(`app:${app.id}`, now);
    this.cache?.touch('apps:list', now);
    const envSvc = new AppEnvService(this.db, this.encryptionKeyHex);

    // Auto-generate DATABASE_URL (and DB_PASSWORD for postgres) when dbEnabled
    let generatedDbPassword: string | undefined;
    if (input.dbEnabled) {
      const dbName = input.dbName ?? input.name;
      const dbType = input.dbType ?? 'postgres';
      if (dbType === 'sqlite') {
        await envSvc.set(app.id, 'DATABASE_URL', `file:${input.deployPath}/${dbName}.db`);
      } else {
        const host = input.pgHost ?? 'localhost';
        const port = input.pgPort ?? 5432;
        generatedDbPassword = randomBytes(16).toString('hex');
        await envSvc.set(app.id, 'DB_PASSWORD', generatedDbPassword);
        await envSvc.set(
          app.id,
          'DATABASE_URL',
          `postgres://${dbName}:${generatedDbPassword}@${host}:${port}/${dbName}`,
        );
      }
    }

    if (input.pgAdminPassword) {
      await envSvc.set(app.id, '_PG_ADMIN_PASSWORD', input.pgAdminPassword);
    }

    if (input.composeContent) {
      await envSvc.set(app.id, '_COMPOSE_CONTENT', input.composeContent);
    }
    if (input.registryToken) {
      await envSvc.set(app.id, '_REGISTRY_TOKEN', input.registryToken);
    }
    if (input.registryUsername) {
      await envSvc.set(app.id, '_REGISTRY_USERNAME', input.registryUsername);
    }

    return {
      app,
      apiKey,
      ...(generatedDbPassword !== undefined ? { generatedDbPassword } : {}),
    };
  }

  async findById(id: string): Promise<App | null> {
    const [row] = await this.db.select().from(apps).where(eq(apps.id, id)).limit(1);
    return row ? rowToApp(row) : null;
  }

  async findByName(name: string): Promise<App | null> {
    const [row] = await this.db.select().from(apps).where(eq(apps.name, name)).limit(1);
    return row ? rowToApp(row) : null;
  }

  async list(): Promise<App[]> {
    const rows = await this.db.select().from(apps);
    return rows.map(rowToApp);
  }

  async update(id: string, input: UpdateAppInput): Promise<App | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const domain       = input.domain       ?? existing.domain;
    const nginxEnabled = input.nginxEnabled ?? existing.nginxEnabled;
    const location     = input.nginxLocation ?? existing.nginxLocation;
    await this.assertNginxUnique(domain, location, nginxEnabled, id);

    const { pgAdminPassword, composeContent, internalNetwork: rawInternalNetwork, packageVersion, registryToken, registryUsername, ...otherDbFields } = input;
    const isDockerApp = existing.type === 'docker' || existing.type === 'compose';
    const dbFields = {
      ...otherDbFields,
      ...(isDockerApp && rawInternalNetwork !== undefined ? { internalNetwork: rawInternalNetwork } : {}),
      ...(packageVersion !== undefined ? { packageVersion } : {}),
    };
    const envSvc = new AppEnvService(this.db, this.encryptionKeyHex);

    if (pgAdminPassword) {
      await envSvc.set(id, '_PG_ADMIN_PASSWORD', pgAdminPassword);
    }
    if (composeContent) {
      await envSvc.set(id, '_COMPOSE_CONTENT', composeContent);
    }
    if (registryToken) {
      await envSvc.set(id, '_REGISTRY_TOKEN', registryToken);
    }
    if (registryUsername) {
      await envSvc.set(id, '_REGISTRY_USERNAME', registryUsername);
    }

    const updatedAt = new Date();
    const [row] = await this.db
      .update(apps)
      .set({ ...dbFields, updatedAt })
      .where(eq(apps.id, id))
      .returning();
    if (row) {
      this.cache?.touch(`app:${id}`, updatedAt);
      this.cache?.touch('apps:list', updatedAt);
    }
    return row ? rowToApp(row) : null;
  }

  async delete(id: string): Promise<void> {
    const envSvc = new AppEnvService(this.db, this.encryptionKeyHex);
    await envSvc.deleteAll(id);
    await this.db.delete(apps).where(eq(apps.id, id));
    this.cache?.delete(`app:${id}`);
    this.cache?.touch('apps:list');
  }

  async listDeployments(appId: string, limit = 20): Promise<Deployment[]> {
    const rows = await this.db
      .select()
      .from(deployments)
      .where(eq(deployments.appId, appId))
      .orderBy(desc(deployments.createdAt))
      .limit(limit);
    return rows.map(rowToDeployment);
  }

  async listAllDeployments(limit = 20): Promise<Deployment[]> {
    const rows = await this.db
      .select()
      .from(deployments)
      .orderBy(desc(deployments.createdAt))
      .limit(limit);
    return rows.map(rowToDeployment);
  }

  private async assertNginxUnique(
    domain: string | undefined,
    location: string,
    nginxEnabled: boolean,
    excludeId: string | null,
  ): Promise<void> {
    if (!nginxEnabled || !domain) return;
    const conditions = [
      eq(apps.domain, domain),
      eq(apps.nginxLocation, location),
      eq(apps.nginxEnabled, true),
    ];
    if (excludeId) conditions.push(ne(apps.id, excludeId));
    const [conflict] = await this.db
      .select({ name: apps.name })
      .from(apps)
      .where(and(...conditions))
      .limit(1);
    if (conflict) {
      throw new ConflictError(
        `Domain "${domain}" with location "${location}" is already used by app "${conflict.name}"`,
      );
    }
  }

  private async assertPortUnique(port: number | undefined, excludeId: string | null): Promise<void> {
    if (port == null) return;
    const conditions = [eq(apps.port, port)];
    if (excludeId) conditions.push(ne(apps.id, excludeId));
    const [conflict] = await this.db
      .select({ name: apps.name })
      .from(apps)
      .where(and(...conditions))
      .limit(1);
    if (conflict) {
      throw new ConflictError(
        `Port ${port} is already assigned to app "${conflict.name}"`,
      );
    }
  }
}
