export const deploymentIdParam = {
  type: 'object',
  required: ['deploymentId'],
  properties: {
    deploymentId: { type: 'string' },
  },
} as const;

export const deployBody = {
  type: 'object',
  properties: {
    triggeredBy:   { type: 'string', enum: ['api', 'mcp'], default: 'api' },
    allowDbDrop:   { type: 'boolean', default: false },
    envVars:       { type: 'object', additionalProperties: { type: 'string' } },
  },
  additionalProperties: false,
} as const;

export const migrateBody = {
  type: 'object',
  required: ['direction'],
  properties: {
    direction: { type: 'string', enum: ['up', 'down'] },
    steps:     { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
} as const;
