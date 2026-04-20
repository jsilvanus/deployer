import { Registry, collectDefaultMetrics, Gauge, Counter, Histogram } from 'prom-client';

const GLOBAL_KEY = '__deployer_metrics_registry_v1';

type MetricMaps = {
  gauges: Map<string, Gauge<string>>;
  counters: Map<string, Counter<string>>;
  histograms: Map<string, Histogram<string>>;
  registry: Registry | null;
};

function getGlobal(): MetricMaps {
  // @ts-ignore global cache
  if (!globalThis[GLOBAL_KEY]) {
    const registry = new Registry();
    // collect default process metrics into our registry
    collectDefaultMetrics({ register: registry });
    globalThis[GLOBAL_KEY] = {
      gauges: new Map(),
      counters: new Map(),
      histograms: new Map(),
      registry,
    } as MetricMaps;
  }
  // @ts-ignore
  return globalThis[GLOBAL_KEY] as MetricMaps;
}

export function getRegistry(): Registry {
  return getGlobal().registry!;
}

export function getOrCreateGauge(name: string, help: string, labelNames: string[] = []) {
  const g = getGlobal();
  if (!g.gauges.has(name)) {
    const gauge = new Gauge({ name, help, labelNames, registers: [g.registry!] });
    g.gauges.set(name, gauge);
  }
  return g.gauges.get(name)!;
}

export function setGaugeValue(name: string, labels: Record<string, string> | number, value?: number) {
  const g = getGlobal();
  if (typeof labels === 'number') {
    // no labels
    const gauge = getOrCreateGauge(name, name, []);
    gauge.set(labels);
    return;
  }
  const labelKeys = Object.keys(labels);
  const gauge = getOrCreateGauge(name, name, labelKeys);
  gauge.set(labels, value ?? 0);
}

export function getOrCreateCounter(name: string, help: string, labelNames: string[] = []) {
  const g = getGlobal();
  if (!g.counters.has(name)) {
    const c = new Counter({ name, help, labelNames, registers: [g.registry!] });
    g.counters.set(name, c);
  }
  return g.counters.get(name)!;
}

export function incCounter(name: string, labels?: Record<string, string>, value = 1) {
  const c = getOrCreateCounter(name, name, labels ? Object.keys(labels) : []);
  if (labels) c.inc(labels, value);
  else c.inc(value);
}

export function getOrCreateHistogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]) {
  const g = getGlobal();
  if (!g.histograms.has(name)) {
    const h = new Histogram({ name, help, labelNames, registers: [g.registry!], buckets });
    g.histograms.set(name, h);
  }
  return g.histograms.get(name)!;
}

export async function getMetricsText(): Promise<string> {
  return await getGlobal().registry!.metrics();
}

export default {
  getRegistry,
  getOrCreateGauge,
  setGaugeValue,
  getOrCreateCounter,
  incCounter,
  getOrCreateHistogram,
  getMetricsText,
};
