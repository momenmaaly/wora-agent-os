/** In-process metrics, correlation ids and redacted structured log fields. */
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../os/secrets.js';

const counters = new Map<string, number>();
const timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();
const startedAt = Date.now();

export function newCorrelationId(): string {
  return `cor_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function incrementMetric(name: string, labels: Record<string, string> = {}, amount = 1): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

export function observeDuration(name: string, durationMs: number, labels: Record<string, string> = {}): void {
  const key = metricKey(name, labels);
  const current = timings.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += Math.max(0, durationMs);
  current.maxMs = Math.max(current.maxMs, durationMs);
  timings.set(key, current);
}

function metricKey(name: string, labels: Record<string, string>): string {
  const suffix = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}="${String(value).replace(/["\\\n]/gu, '_').slice(0, 80)}"`).join(',');
  return suffix ? `${name}{${suffix}}` : name;
}

export function metricsSnapshot(): { uptimeSeconds: number; counters: Record<string, number>; timings: Record<string, { count: number; averageMs: number; maxMs: number }> } {
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
    counters: Object.fromEntries(counters),
    timings: Object.fromEntries([...timings].map(([key, value]) => [key, {
      count: value.count, averageMs: Math.round(value.totalMs / Math.max(1, value.count)), maxMs: Math.round(value.maxMs),
    }])),
  };
}

export function metricsPrometheus(): string {
  const snapshot = metricsSnapshot();
  const lines = [`# HELP wora_uptime_seconds Process uptime`, `# TYPE wora_uptime_seconds gauge`, `wora_uptime_seconds ${snapshot.uptimeSeconds}`];
  for (const [key, value] of Object.entries(snapshot.counters)) lines.push(`wora_counter_${key.replace(/[^a-zA-Z0-9_]/gu, '_')} ${value}`);
  for (const [key, value] of Object.entries(snapshot.timings)) {
    const safe = key.replace(/[^a-zA-Z0-9_]/gu, '_');
    lines.push(`wora_timing_${safe}_count ${value.count}`, `wora_timing_${safe}_average_ms ${value.averageMs}`, `wora_timing_${safe}_max_ms ${value.maxMs}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Redact before a value reaches a log sink. */
export function redactForLog(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value).value;
  try { return JSON.parse(redactSecrets(JSON.stringify(value)).value) as unknown; } catch { return '[unserializable]'; }
}
