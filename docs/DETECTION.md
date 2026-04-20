# App Detection — Deployer

This document describes the app detection service used by Deployer to infer app type and recommended build/run commands.

Key points:

- Detection inspects repo files and returns a `DetectionResult` object (see `src/types/detection.ts`).
- Supported types: `node`, `python-pypi`, `python`, `docker`, `compose`, `unknown`.
- Overrides:
  - Environment variable: `DEPLOYER_FORCE_CONTAINER_TYPE` (set to `node`, `python`, `python-pypi`, `docker`, or `compose`).
  - File override: create `deployer.container.json` at repo root with `{ "type": "node", "entrypoint": "node dist/index.js" }`.
- Safety: auto-containerization is gated by `DEPLOYER_DOCKER_MODE` in `src/config.ts`.
- Detection output should be stored in deployment snapshots for auditability. Use `src/services/detection-snapshot.service.ts` to persist snapshots.

Usage examples:

- Run detection programmatically:

```ts
import AppDetectionService from '../src/services/app-detection.service';

const svc = new AppDetectionService('/path/to/checkout');
const result = await svc.detectWithOverrides();
console.log(result);
```

- Persist detection snapshot during a deployment (pseudo-code):

```ts
import { getDb } from '../src/db/client';
import saveDetectionSnapshot from '../src/services/detection-snapshot.service';

const db = getDb('./deployer.db');
await saveDetectionSnapshot(db, deploymentId, 'detection', 1, result);
```

