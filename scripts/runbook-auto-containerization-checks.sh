#!/usr/bin/env sh
# POSIX-safe preflight checks for Auto-Containerization rollout (non-destructive)
set -euo pipefail

echo "Auto-containerization runbook checks: starting quick local verification"

# 1. Tool checks
missing=0
for cmd in node npm git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd"
    missing=$((missing+1))
  fi
done
if [ "$missing" -gt 0 ]; then
  echo "Install missing tools and re-run the script."
  exit 2
fi

echo "Tooling: node $(node --version), npm $(npm --version), git $(git --version)"

# 2. Git cleanliness (warning only)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "WARNING: git working tree is dirty. Consider committing or stashing changes."
  else
    echo "Git working tree: clean"
  fi
else
  echo "Not in a git repo; skipping git cleanliness check"
fi

# 3. Env var checks
if [ -z "${DEPLOYER_ADMIN_TOKEN:-}" ]; then
  echo "WARNING: DEPLOYER_ADMIN_TOKEN is not set"
fi

if [ -z "${DEPLOYER_ENV_ENCRYPTION_KEY:-}" ]; then
  echo "ERROR: DEPLOYER_ENV_ENCRYPTION_KEY not set"
  exit 3
fi

keylen=$(printf "%s" "$DEPLOYER_ENV_ENCRYPTION_KEY" | wc -c)
if [ "$keylen" -ne 64 ]; then
  echo "ERROR: DEPLOYER_ENV_ENCRYPTION_KEY must be exactly 64 hex chars (found length: $keylen)"
  exit 3
fi
echo "Environment variables: DEPLOYER_ENV_ENCRYPTION_KEY length ok"

# 4. Typecheck (if TypeScript available)
if command -v npx >/dev/null 2>&1; then
  echo "Running TypeScript check (npx tsc --noEmit)"
  if ! npx -y tsc --noEmit; then
    echo "TypeScript errors detected. Fix before proceeding."
    exit 4
  fi
else
  echo "npx not available: skipping TypeScript check"
fi

# 5. Run tests (non-destructive)
if [ -f package.json ]; then
  echo "Running npm test (this may take a moment)"
  if npm run test --silent; then
    echo "Tests: OK"
  else
    echo "Tests failed — examine output before deploying"
    exit 5
  fi
else
  echo "package.json not found: skipping npm test"
fi

echo "Runbook checks: all quick checks passed"
exit 0
