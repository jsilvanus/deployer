import fetch from 'node-fetch';

type ClientOptions = {
  host?: string;
  port?: number | string;
  token?: string;
  timeoutMs?: number;
  cliVersion?: string;
};

let opts: ClientOptions = {};

export function initClient(o: ClientOptions) {
  opts = { timeoutMs: 20000, cliVersion: 'dev', ...o };
}

function baseUrl() {
  const host = opts.host ?? process.env.DEPLOYER_HOST ?? '127.0.0.1';
  const port = opts.port ?? process.env.DEPLOYER_PORT ?? '3000';
  return `http://${host}:${port}`;
}

async function request(method: string, path: string, body?: any) {
  const url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': `${Date.now().toString(16)}-${Math.random().toString(16).slice(2,8)}`,
    'X-CLI-Version': opts.cliVersion ?? 'dev',
  };
  const token = opts.token ?? process.env.DEPLOYER_ADMIN_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // node-fetch does not support timeout in options in v3; consumers can implement their own timeout
  });

  const text = await res.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err: any = new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return parsed ?? text;
}

export async function createApp(input: any) {
  return request('POST', '/apps', input);
}

export async function updateApp(appId: string, input: any) {
  return request('PATCH', `/apps/${encodeURIComponent(appId)}`, input);
}

export async function deleteApp(appId: string) {
  return request('DELETE', `/apps/${encodeURIComponent(appId)}`);
}

export async function listApps() {
  return request('GET', '/apps');
}

export async function getApp(appId: string) {
  return request('GET', `/apps/${encodeURIComponent(appId)}`);
}

export async function deployApp(appId: string, payload: any) {
  return request('POST', `/apps/${encodeURIComponent(appId)}/deploy`, payload);
}

export async function getStatus(appId: string) {
  return request('GET', `/apps/${encodeURIComponent(appId)}/status`);
}

export default {
  initClient,
  createApp,
  updateApp,
  deleteApp,
  listApps,
  getApp,
  deployApp,
  getStatus,
};
