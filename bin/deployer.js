#!/usr/bin/env node
/**
 * Main CLI entry point for @jsilvanus/deployer.
 *
 *   deployer              Start the server (reads .env from cwd if present)
 *   deployer start        Same as above
 *   deployer setup [...]  Run the interactive bare-metal setup wizard (requires sudo)
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the current working directory into process.env.
// Variables already set in the environment take precedence.
function loadDotEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* no .env — rely on process.env */ }
}

const cmd = process.argv[2];

if (cmd === 'setup') {
  // Forward all remaining args to the interactive setup wizard
  spawn('node', [resolve(__dirname, 'setup.js'), ...process.argv.slice(3)], {
    stdio: 'inherit',
  }).on('exit', (code) => process.exit(code ?? 0));
} else if (!cmd || cmd === 'start') {
  loadDotEnv();
  spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], {
    stdio: 'inherit',
    env: process.env,
  }).on('exit', (code) => process.exit(code ?? 0));
} else {
  console.error(`deployer: unknown command "${cmd}"\n`);
  console.log('Usage:');
  console.log('  deployer                 Start the deployer server');
  console.log('  deployer start           Start the deployer server');
  console.log('  deployer setup [opts]    Run the bare-metal setup wizard (requires sudo)');
  process.exit(1);
}
