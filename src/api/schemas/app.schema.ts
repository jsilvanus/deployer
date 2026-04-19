export const createAppBody = {
  type: 'object',
  required: ['name', 'type', 'deployPath'],
  properties: {
    name:           { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9-]+$' },
    type:           { type: 'string', enum: ['node', 'python', 'docker', 'compose', 'npm'] },
    repoUrl:        { type: 'string', minLength: 1 },
    branch:         { type: 'string', minLength: 1, default: 'main' },
    deployPath:     { type: 'string', minLength: 1 },
    composeContent:  { type: 'string', minLength: 1 },
    primaryService:  { type: 'string', minLength: 1 },
    internalNetwork: { type: 'boolean', default: true },
    dockerCompose:   { type: 'boolean', default: false },
    nginxEnabled:   { type: 'boolean', default: false },
    nginxLocation:  { type: 'string', default: '/' },
    domain:         { type: 'string' },
    dbEnabled:      { type: 'boolean', default: false },
    dbType:         { type: 'string', enum: ['postgres', 'sqlite'], default: 'postgres' },
    dbName:         { type: 'string' },
    port:           { type: 'integer', minimum: 1, maximum: 65535 },
    packageName:    { type: 'string', minLength: 1 },
    packageVersion: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const updateAppBody = {
  type: 'object',
  properties: {
    composeContent:  { type: 'string', minLength: 1 },
    primaryService:  { type: 'string', minLength: 1 },
    internalNetwork: { type: 'boolean' },
    branch:          { type: 'string', minLength: 1 },
    domain:         { type: 'string' },
    nginxEnabled:   { type: 'boolean' },
    nginxLocation:  { type: 'string' },
    dbEnabled:      { type: 'boolean' },
    dbType:         { type: 'string', enum: ['postgres', 'sqlite'] },
    dbName:         { type: 'string' },
    port:           { type: 'integer', minimum: 1, maximum: 65535 },
    packageVersion: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

export const appIdParam = {
  type: 'object',
  required: ['appId'],
  properties: {
    appId: { type: 'string' },
  },
} as const;
