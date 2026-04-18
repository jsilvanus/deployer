export const createAppBody = {
  type: 'object',
  required: ['name', 'type', 'repoUrl', 'deployPath'],
  properties: {
    name:          { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9-]+$' },
    type:          { type: 'string', enum: ['node', 'docker'] },
    repoUrl:       { type: 'string', minLength: 1 },
    branch:        { type: 'string', minLength: 1, default: 'main' },
    deployPath:    { type: 'string', minLength: 1 },
    dockerCompose: { type: 'boolean', default: false },
    nginxEnabled:  { type: 'boolean', default: false },
    domain:        { type: 'string' },
    dbEnabled:     { type: 'boolean', default: false },
    dbType:        { type: 'string', enum: ['postgres', 'sqlite'], default: 'postgres' },
    dbName:        { type: 'string' },
    port:          { type: 'integer', minimum: 1, maximum: 65535 },
  },
  additionalProperties: false,
} as const;

export const updateAppBody = {
  type: 'object',
  properties: {
    branch:       { type: 'string', minLength: 1 },
    domain:       { type: 'string' },
    nginxEnabled: { type: 'boolean' },
    dbEnabled:    { type: 'boolean' },
    dbType:       { type: 'string', enum: ['postgres', 'sqlite'] },
    dbName:       { type: 'string' },
    port:         { type: 'integer', minimum: 1, maximum: 65535 },
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
