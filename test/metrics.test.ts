import { describe, it, expect } from 'vitest';
import metricsRegistry from '../src/services/metrics.registry.js';

describe('metrics registry', () => {
  it('exposes HTTP metrics after recording', async () => {
    const counter = metricsRegistry.getOrCreateCounter('http_requests_total', 'Test HTTP counter', ['method','route','status']);
    counter.inc({ method: 'GET', route: '/test', status: '200' }, 1);
    const text = await metricsRegistry.getMetricsText();
    expect(text).toContain('http_requests_total{method="GET",route="/test",status="200"} 1');
  });
});
