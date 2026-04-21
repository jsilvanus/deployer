#!/usr/bin/env node
/**
 * Simplified CLI entry for @jsilvanus/deployer.
 * Keeps the original behavior but with a clearer, balanced implementation.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import * as CliClient from './cli-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
}

function printUsage() {
  console.log('Usage:');
  console.log('  deployer server');
  console.log('  deployer setup [opts]');
  console.log('  deployer add <json|@file>');
  console.log('  deployer update <appId> <json|@file>');
  console.log('  deployer remove <appId>');
  console.log('  deployer list|get|deploy|rollback|status|logs|metrics');
  console.log('  deployer self-update [--name <appName>] [--wait]');
  console.log('  deployer self-shutdown [--dry-run] [--delete] [--confirm-token <token>]');
}

function readJsonArg(arg, rest) {
  const { existsSync, readFileSync } = require('node:fs');
  if (!arg) return null;
  if (arg.startsWith('@')) {
    const p = arg.slice(1);
    if (!existsSync(p)) { console.error(`File not found: ${p}`); process.exit(2); }
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { console.error(`Invalid JSON in ${p}: ${e.message}`); process.exit(2); }
  }
  if (arg.trim().startsWith('{') || arg.trim().startsWith('[')) {
    try { return JSON.parse(arg); } catch (e) { console.error('Invalid JSON:', e.message); process.exit(2); }
  }
  if (rest && rest.length > 0) {
    const joined = [arg, ...rest].join(' ');
    try { return JSON.parse(joined); } catch {}
  }
  console.error('Expected JSON body or @file.json'); process.exit(2);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) { printUsage(); process.exit(0); }
  if (cmd === '--help' || cmd === '-h') { printUsage(); process.exit(0); }

  if (cmd === 'setup') {
    spawn('node', [resolve(__dirname, 'setup.js'), ...process.argv.slice(3)], { stdio: 'inherit' }).on('exit', c => process.exit(c ?? 0));
    return;
  }
  if (cmd === 'server' || cmd === 'start') {
    loadDotEnv();
    spawn('node', [resolve(__dirname, '..', 'dist', 'index.js')], { stdio: 'inherit', env: process.env }).on('exit', c => process.exit(c ?? 0));
    return;
  }

  // Other commands that proxy to the running API
  const sub = cmd;
  try {
    if (sub === 'add') {
      const body = readJsonArg(process.argv[3], process.argv.slice(4));
      const res = await CliClient.createApp(body); console.log(JSON.stringify(res, null, 2)); return;
    }
    if (sub === 'update') {
      const appId = process.argv[3]; if (!appId) { console.error('update requires <appId> <json|@file>'); printUsage(); process.exit(2); }
      const body = readJsonArg(process.argv[4], process.argv.slice(5)); const res = await CliClient.updateApp(appId, body); console.log(JSON.stringify(res, null, 2)); return;
    }
    if (sub === 'remove') { const appId = process.argv[3]; if (!appId) { console.error('remove requires <appId>'); printUsage(); process.exit(2); } const res = await CliClient.deleteApp(appId); console.log(JSON.stringify(res, null, 2)); return; }
    if (sub === 'list') { const res = await CliClient.listApps(); console.log(JSON.stringify(res, null, 2)); return; }
    if (sub === 'get') { const appId = process.argv[3]; if (!appId) { console.error('get requires <appId>'); printUsage(); process.exit(2); } const res = await CliClient.getApp(appId); console.log(JSON.stringify(res, null, 2)); return; }
    if (sub === 'deploy') {
      const appId = process.argv[3]; if (!appId) { console.error('deploy requires <appId>'); printUsage(); process.exit(2); }
      const payload = {}; if (process.argv.includes('--allow-db-drop')) payload.allowDbDrop = true;
      const wait = process.argv.includes('--wait'); const res = await CliClient.deployApp(appId, payload); console.log(JSON.stringify(res, null, 2));
      if (wait && res?.deploymentId) {
        const id = res.deploymentId; process.stdout.write(`Waiting for deployment ${id}...\n`);
        for (;;) { await new Promise(r => setTimeout(r,2000)); try { const status = await CliClient.getDeployment(id); process.stdout.write(`status: ${status.status} currentStep: ${status.currentStep ?? '-'}\n`); if (['success','failed','rolled_back'].includes(status.status)) { process.stdout.write(`Deployment finished: ${status.status}\n`); break; } } catch (e) { process.stderr.write(`Error polling deployment: ${e?.message ?? e}\n`); } }
      }
      return;
    }
    if (sub === 'rollback') { const appId = process.argv[3]; const deploymentId = process.argv[4]; if (!appId || !deploymentId) { console.error('rollback requires <appId> <deploymentId>'); printUsage(); process.exit(2); } const wait = process.argv.includes('--wait'); const res = await CliClient.rollbackDeployment(deploymentId, {}); console.log(JSON.stringify(res, null, 2)); if (wait && res?.deploymentId) { const id = res.deploymentId; process.stdout.write(`Waiting for rollback deployment ${id}...\n`); for (;;) { await new Promise(r => setTimeout(r,2000)); try { const status = await CliClient.getDeployment(id); process.stdout.write(`status: ${status.status} currentStep: ${status.currentStep ?? '-'}\n`); if (['success','failed','rolled_back'].includes(status.status)) { process.stdout.write(`Rollback finished: ${status.status}\n`); break; } } catch (e) { process.stderr.write(`Error polling rollback deployment: ${e?.message ?? e}\n`); } } } return; }
    if (sub === 'status') { const appId = process.argv[3]; if (!appId) { console.error('status requires <appId>'); printUsage(); process.exit(2); } const res = await CliClient.getStatus(appId); console.log(JSON.stringify(res, null, 2)); return; }
    if (sub === 'logs') { const appId = process.argv[3]; if (!appId) { console.error('logs requires <appId>'); printUsage(); process.exit(2); } const params = {}; if (process.argv.includes('--follow')) { params.follow = true; await CliClient.getLogs(appId, params); return; } if (process.argv.includes('--since')) { const idx = process.argv.indexOf('--since'); params.since = process.argv[idx+1]; } const res = await CliClient.getLogs(appId, params); console.log(JSON.stringify(res, null, 2)); return; }
    if (sub === 'metrics') { const appId = process.argv[3]; if (!appId) { console.error('metrics requires <appId>'); printUsage(); process.exit(2); } const res = await CliClient.getMetrics(appId, {}); console.log(JSON.stringify(res, null, 2)); return; }

    // New: self-update
    if (sub === 'self-update') {
      const nameIdx = process.argv.indexOf('--name'); const name = nameIdx !== -1 ? process.argv[nameIdx+1] : undefined; const wait = process.argv.includes('--wait'); const res = await CliClient.selfUpdate(name); console.log(JSON.stringify(res, null, 2)); if (wait && res?.deploymentId) { const id = res.deploymentId; process.stdout.write(`Waiting for deployment ${id}...\n`); for (;;) { await new Promise(r => setTimeout(r,2000)); try { const status = await CliClient.getDeployment(id); process.stdout.write(`status: ${status.status} currentStep: ${status.currentStep ?? '-'}\n`); if (['success','failed','rolled_back'].includes(status.status)) { process.stdout.write(`Deployment finished: ${status.status}\n`); break; } } catch (e) { process.stderr.write(`Error polling deployment: ${e?.message ?? e}\n`); } } } return;
    }

    // New: self-shutdown
    if (sub === 'self-shutdown') {
      const dryRun = process.argv.includes('--dry-run'); const del = process.argv.includes('--delete'); const tokenIdx = process.argv.indexOf('--confirm-token'); const confirmToken = tokenIdx !== -1 ? process.argv[tokenIdx+1] : undefined; if (!dryRun && !confirmToken) { console.error('Non-dry-run self-shutdown requires --confirm-token <token> (min 8 chars)'); process.exit(2); }
      const body = { dryRun: dryRun || undefined, deleteInstalled: del || undefined, confirmToken };
      const res = await CliClient.selfShutdown(body); console.log(JSON.stringify(res, null, 2)); return;
    }

    console.error(`deployer: unknown command "${cmd}"\n`);
    printUsage();
    process.exit(1);
  } catch (e) {
    console.error('CLI command failed:', e?.message ?? e);
    process.exit(3);
  }
}

main();
