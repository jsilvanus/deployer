#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function loadDotEnv() {
  try {
    const content = readFileSync(new URL('./.env', import.meta.url).pathname, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {}
}

function baseUrl() {
  const host = process.env.DEPLOYER_HOST || '127.0.0.1';
  const port = process.env.DEPLOYER_PORT || '3000';
  return `http://${host}:${port}`;
}

async function callApi(method, path, body) {
  loadDotEnv();
  const token = process.env.DEPLOYER_ADMIN_TOKEN;
  if (!token) throw new Error('DEPLOYER_ADMIN_TOKEN not found');
  const url = `${baseUrl()}${path}`;
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Request-Id': `${Date.now().toString(16)}-${Math.random().toString(16).slice(2,8)}`, 'X-CLI-Version': 'dev' };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return parsed ?? text;
}

export async function createApp(body) { return callApi('POST', '/apps', body); }
export async function updateApp(appId, body) { return callApi('PATCH', `/apps/${encodeURIComponent(appId)}`, body); }
export async function deleteApp(appId) { return callApi('DELETE', `/apps/${encodeURIComponent(appId)}`); }

export async function listApps() { return callApi('GET', '/apps'); }
export async function getApp(appId) { return callApi('GET', `/apps/${encodeURIComponent(appId)}`); }
export async function deployApp(appId, payload) { return callApi('POST', `/apps/${encodeURIComponent(appId)}/deploy`, payload); }
export async function rollbackDeployment(deploymentId, payload) { return callApi('POST', `/deployments/${encodeURIComponent(deploymentId)}/rollback`, payload); }
export async function getStatus(appId) { return callApi('GET', `/apps/${encodeURIComponent(appId)}/status`); }
export async function getLogs(appId, params) {
  // basic implementation: fetch logs endpoint; params may include since/follow
  let url = `/apps/${encodeURIComponent(appId)}/logs`;
  if (params) {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.follow) qs.set('follow', params.follow ? '1' : '0');
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return callApi('GET', url);
}
export async function getMetrics(appId, params) {
  let url = `/apps/${encodeURIComponent(appId)}/metrics`;
  if (params) {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return callApi('GET', url);
}

export default { createApp, updateApp, deleteApp, listApps, getApp, deployApp, rollbackDeployment, getStatus, getLogs, getMetrics };
