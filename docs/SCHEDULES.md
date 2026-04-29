# Schedules and `runSpec`

Deployer supports scheduled (cronned) one-off runs using per-app `runSpec` definitions. A `runSpec` describes how to execute an ephemeral job for an app and can be used by schedules (or overridden per-schedule).

RunSpec fields

- `runtime` (required): `node` | `python` | `image` | `compose` | `command`
- `command` (array of strings): argv for `node`/`python`/`command` runtimes (e.g. `["node","script.js"]`).
- `image` (string): Docker image for `image` runtime (e.g. `alpine:latest`).
- `service` (string): Compose service name for `compose` runtime.
- `env` (object): key/value env variables to set for the run.
- `timeoutSec` (integer): maximum run duration in seconds (default 300).
- `ephemeral` (boolean): whether the run is ephemeral (default true for scheduled runs).
- `resources` (object): optional runtime hints, e.g. `{ cpus: 0.5, memoryMb: 256 }`.

Security notes

- `command` mode (arbitrary shell commands) is risky. By default only admin-scoped API keys may set `runSpec` with `runtime: 'command'`.
- Use `image` or `compose` runtimes for stronger isolation.

How schedules use runSpec

- When a schedule of `type: 'run'` triggers, the scheduler will look for `payload.runSpec` on the schedule, falling back to the app's `runSpec`.
- The scheduler enforces timeouts, captures a short stdout/stderr summary, and records run history in `schedule_runs`.

Examples

- App `runSpec` (node):

```
{
  "runtime": "node",
  "command": ["node", "scripts/job.js"],
  "timeoutSec": 120,
  "env": { "ENV": "production" }
}
```

- Schedule payload override (image):

```
{
  "runSpec": {
    "runtime": "image",
    "image": "alpine:latest",
    "command": ["/bin/sh", "-c", "echo hello"]
  }
}
```
