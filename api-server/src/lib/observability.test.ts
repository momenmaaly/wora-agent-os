import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incrementMetric, metricsPrometheus, metricsSnapshot, newCorrelationId, observeDuration, redactForLog } from './observability.js';

test('correlation ids are unique and bounded', () => {
  const ids = new Set(Array.from({ length: 20 }, () => newCorrelationId()));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.match(id, /^cor_[a-f0-9]{24}$/u);
});

test('counters and timings aggregate without exposing secrets', () => {
  incrementMetric('wora_test_total', { outcome: 'ok' }, 2);
  incrementMetric('wora_test_total', { outcome: 'ok' });
  observeDuration('wora_test_duration_ms', 10, { tool: 'x' });
  observeDuration('wora_test_duration_ms', 30, { tool: 'x' });
  const snapshot = metricsSnapshot();
  assert.equal(snapshot.counters['wora_test_total{outcome="ok"}'], 3);
  const timing = snapshot.timings['wora_test_duration_ms{tool="x"}'];
  assert.equal(timing?.count, 2);
  assert.equal(timing?.averageMs, 20);
  assert.equal(timing?.maxMs, 30);
  const prometheus = metricsPrometheus();
  assert.match(prometheus, /wora_uptime_seconds/u);
  assert.match(prometheus, /wora_test_total/u);
  assert.ok(!prometheus.includes('sk-'));
});

test('log redaction removes credential-shaped values but keeps structure', () => {
  const token = `sk-${'a'.repeat(32)}`;
  const redacted = redactForLog({ tool: 'fetch', token, nested: { header: `Bearer ${token}` } }) as Record<string, unknown>;
  assert.equal(redacted['tool'], 'fetch');
  assert.ok(!JSON.stringify(redacted).includes(token));
});
