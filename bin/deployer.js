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

// If no command provided, show usage help and exit successfully.
if (!cmd) {
  printUsage();
  process.exit(0);
}
function printUsage() {
  console.log('Usage:');
  console.log('  deployer server                   Start the deployer server');
  console.log('  deployer setup [opts]             Run the bare-metal setup wizard (requires sudo)');
  console.log('  deployer add <json|@file>         Create an app (body JSON or @file.json)');
  console.log('  deployer update <appId> <json|@file>  Update an app');
  console.log('  deployer remove <appId>           Delete an app');
}

async function proxyApiCall(method, path, body) {
  // Ensure env and admin token are loaded
  loadDotEnv();
  const port = process.env.DEPLOYER_PORT || '3000';
  const token = process.env.DEPLOYER_ADMIN_TOKEN;
  if (!token) {
    console.error('DEPLOYER_ADMIN_TOKEN not found in environment or .env — cannot call API');
    process.exit(2);
  }
  const url = `http://127.0.0.1:${port}${path}`;
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      console.error(`API ${method} ${path} failed: ${res.status} ${res.statusText}`);
      console.error(parsed ?? text);
      process.exit(3);
    }
    console.log(parsed ?? text ?? `${res.status} ${res.statusText}`);
  } catch (err) {
    console.error(`Error calling API: ${err?.message ?? err}`);
    process.exit(4);
  }
}

function readJsonArg(arg, rest) {
  // arg can be a JSON string, or @filename to read JSON from file
  const { existsSync, readFileSync } = require('node:fs');
  if (!arg) return null;
  if (arg.startsWith('@')) {
    const p = arg.slice(1);
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(2);
    }
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      console.error(`Invalid JSON in ${p}: ${e.message}`);
      process.exit(2);
    }
  }
  // If arg looks like JSON, parse it; otherwise try to join rest as JSON
  if (arg.trim().startsWith('{') || arg.trim().startsWith('[')) {
    try { return JSON.parse(arg); } catch (e) { console.error('Invalid JSON:', e.message); process.exit(2); }
  }
  if (rest && rest.length > 0) {
    const joined = [arg, ...rest].join(' ');
    try { return JSON.parse(joined); } catch { /* fallthrough */ }
  }
  console.error('Expected JSON body or @file.json');
  process.exit(2);
}

if (cmd === 'setup') {
  // Forward all remaining args to the interactive setup wizard
  spawn('node', [resolve(__dirname, 'setup.js'), ...process.argv.slice(3)], {
    stdio: 'inherit',
  }).on('exit', (code) => process.exit(code ?? 0));
} else if (cmd === 'server' || cmd === 'start') {
  // Start server explicitly
  loadDotEnv();
  spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], {
    stdio: 'inherit',
    env: process.env,
  }).on('exit', (code) => process.exit(code ?? 0));
} else if (cmd === 'add' || cmd === 'update' || cmd === 'remove') {
  // Lightweight CLI that calls the local Deployer API using DEPLOYER_ADMIN_TOKEN
  const sub = cmd;
  (async () => {
    if (sub === 'add') {
      const body = readJsonArg(process.argv[3], process.argv.slice(4));
      await proxyApiCall('POST', '/setup/self-register' in {} ? '/apps' : '/apps', body);
    } else if (sub === 'update') {
      const appId = process.argv[3];
      if (!appId) { console.error('update requires <appId> <json|@file>'); printUsage(); process.exit(2); }
      const body = readJsonArg(process.argv[4], process.argv.slice(5));
      await proxyApiCall('PATCH', `/apps/${encodeURIComponent(appId)}`, body);
    } else if (sub === 'remove') {
      const appId = process.argv[3];
      if (!appId) { console.error('remove requires <appId>'); printUsage(); process.exit(2); }
      await proxyApiCall('DELETE', `/apps/${encodeURIComponent(appId)}`);
    }
    process.exit(0);
  })();
} else {
  console.error(`deployer: unknown command "${cmd}"\n`);
  printUsage();
  process.exit(1);
}
