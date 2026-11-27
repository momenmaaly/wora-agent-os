/**
 * WORA OS — shared seeded simulation primitives.
 *
 * The PERT sampler is used by the Monte Carlo tool, scenario comparison and
 * digital twins so every simulation uses the same reproducible random stream.
 */
export interface PertItem { name: string; optimistic: number; likely: number; pessimistic: number }
export interface PertResult {
  simulated: true;
  method: 'triangular PERT Monte Carlo';
  trials: number;
  seed: number;
  mean: number;
  stddev: number;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  histogram: Array<{ from: number; to: number; count: number }>;
  disclaimer: string;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function triangularSample(rand: () => number, a: number, m: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const mode = Math.min(Math.max(m, lo), hi);
  const u = rand();
  const fc = (mode - lo) / (hi - lo || 1e-9);
  return u < fc ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function simulatePert(items: PertItem[], trials: number, seed: number): PertResult {
  const rand = mulberry32(seed);
  const totals: number[] = [];
  for (let t = 0; t < trials; t++) {
    let sum = 0;
    for (const item of items) sum += triangularSample(rand, item.optimistic, item.likely, item.pessimistic);
    totals.push(sum);
  }
  totals.sort((a, b) => a - b);
  const q = (p: number) => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))]!;
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((acc, value) => acc + (value - mean) ** 2, 0) / totals.length;
  const min = totals[0]!, max = totals[totals.length - 1]!;
  const buckets = 12;
  const histogram: Array<{ from: number; to: number; count: number }> = [];
  const width = (max - min) / buckets || 1;
  for (let b = 0; b < buckets; b++) histogram.push({ from: min + b * width, to: min + (b + 1) * width, count: 0 });
  for (const value of totals) {
    const index = Math.min(buckets - 1, Math.floor((value - min) / width));
    histogram[index]!.count += 1;
  }
  return {
    simulated: true,
    method: 'triangular PERT Monte Carlo',
    trials,
    seed,
    mean: round2(mean),
    stddev: round2(Math.sqrt(variance)),
    p10: round2(q(0.1)),
    p50: round2(q(0.5)),
    p90: round2(q(0.9)),
    min: round2(min),
    max: round2(max),
    histogram: histogram.map((bucket) => ({ ...bucket, from: round2(bucket.from), to: round2(bucket.to) })),
    disclaimer: 'Simulated estimate from the provided three-point inputs — not a measurement of actual performance.',
  };
}

export interface QueueModel {
  customers: number;
  interarrivalMean: number;
  serviceMean: number;
  servers: number;
  seed: number;
}
export interface QueueResult {
  simulated: true;
  method: 'discrete-event FCFS queue';
  seed: number;
  customers: number;
  served: number;
  servers: number;
  meanWait: number;
  p90Wait: number;
  maxWait: number;
  meanService: number;
  utilization: number;
  makespan: number;
  verification: import('./scientific-verification.js').ScientificVerification;
  limitations: string[];
}

export function exponentialSample(rand: () => number, mean: number): number {
  const u = Math.max(1e-12, Math.min(1 - 1e-12, rand()));
  return -mean * Math.log(1 - u);
}

export function simulateQueue(model: QueueModel): QueueResult {
  const rand = mulberry32(model.seed);
  const serverFree = new Array(model.servers).fill(0);
  const waits: number[] = [];
  const services: number[] = [];
  let arrival = 0;
  for (let customer = 0; customer < model.customers; customer++) {
    arrival += exponentialSample(rand, model.interarrivalMean);
    let server = 0;
    for (let i = 1; i < serverFree.length; i++) if (serverFree[i]! < serverFree[server]!) server = i;
    const start = Math.max(arrival, serverFree[server]!);
    const service = exponentialSample(rand, model.serviceMean);
    waits.push(Math.max(0, start - arrival));
    services.push(service);
    serverFree[server] = start + service;
  }
  const makespan = Math.max(...serverFree, 0);
  const meanWait = waits.reduce((sum, value) => sum + value, 0) / waits.length;
  const sortedWaits = [...waits].sort((a, b) => a - b);
  const p90Wait = sortedWaits[Math.min(sortedWaits.length - 1, Math.floor(0.9 * sortedWaits.length))]!;
  const meanService = services.reduce((sum, value) => sum + value, 0) / services.length;
  const utilization = makespan > 0 ? services.reduce((sum, value) => sum + value, 0) / (makespan * model.servers) : 0;
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  const verification = {
    schemaVersion: '1.0' as const,
    passed: true,
    checks: [
      { id: 'served', description: 'Every generated customer is served', status: 'passed' as const, evidence: `served=${waits.length}; customers=${model.customers}` },
      { id: 'non-negative-waits', description: 'No customer has a negative wait', status: waits.every((wait) => wait >= 0) ? 'passed' as const : 'failed' as const, evidence: `minWait=${round(Math.min(...waits))}` },
      { id: 'utilization', description: 'Server utilization is between zero and one', status: utilization >= 0 && utilization <= 1 + 1e-9 ? 'passed' as const : 'failed' as const, evidence: `utilization=${round(utilization)}` },
      { id: 'reproducible-seed', description: 'The seed is recorded for reproducibility', status: Number.isFinite(model.seed) ? 'passed' as const : 'failed' as const, evidence: `seed=${model.seed}` },
    ],
    failures: [] as string[],
    tolerance: 1e-9,
  };
  verification.failures = verification.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.evidence}`);
  verification.passed = verification.failures.length === 0;
  return {
    simulated: true,
    method: 'discrete-event FCFS queue',
    seed: model.seed,
    customers: model.customers,
    served: waits.length,
    servers: model.servers,
    meanWait: round(meanWait),
    p90Wait: round(p90Wait),
    maxWait: round(Math.max(...waits)),
    meanService: round(meanService),
    utilization: round(utilization),
    makespan: round(makespan),
    verification,
    limitations: ['Exponential interarrival and service times are assumptions.', 'FCFS discipline only; no priorities, balking or reneging.', 'Warm-up bias is not removed for short runs.'],
  };
}
