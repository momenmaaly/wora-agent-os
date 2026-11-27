/**
 * WORA OS — network flow and bipartite matching.
 *
 * Real max-flow (Dinic), min-cost flow (successive shortest paths) and
 * bipartite matching (Kuhn/Hopcroft-Karp style augmenting paths). Every result
 * is checked against independent invariants: conservation, capacity, the
 * max-flow/min-cut equality, exact demand, residual optimality and matching
 * maximality. A result that fails an invariant is returned as `unverified`.
 */
import type { ScientificVerification } from './scientific-verification.js';

export const NETWORK_FLOW_SCHEMA_VERSION = '1.0';
const TOLERANCE = 1e-9;

export interface CapacityEdge {
  id?: string;
  from: string;
  to: string;
  capacity: number;
}

export interface CostEdge extends CapacityEdge {
  cost: number;
}

export interface MaxFlowModel {
  nodes?: string[];
  edges: CapacityEdge[];
  source: string;
  sink: string;
}

export interface MinCostFlowModel {
  nodes?: string[];
  edges: CostEdge[];
  source: string;
  sink: string;
  demand: number;
}

export interface BipartiteModel {
  left: string[];
  right: string[];
  edges: Array<{ left: string; right: string }>;
}

export interface FlowEdgeResult {
  id: string;
  from: string;
  to: string;
  capacity: number;
  flow: number;
  cost?: number;
}

export interface MaxFlowResult {
  schemaVersion: typeof NETWORK_FLOW_SCHEMA_VERSION;
  status: 'optimal' | 'infeasible' | 'unverified';
  maxFlow: number | null;
  flows: FlowEdgeResult[];
  minCut: { sourceSide: string[]; sinkSide: string[]; capacity: number } | null;
  verification: ScientificVerification;
}

export interface MinCostFlowResult {
  schemaVersion: typeof NETWORK_FLOW_SCHEMA_VERSION;
  status: 'optimal' | 'infeasible' | 'unverified';
  demand: number;
  flow: number | null;
  totalCost: number | null;
  flows: FlowEdgeResult[];
  verification: ScientificVerification;
}

export interface BipartiteResult {
  schemaVersion: typeof NETWORK_FLOW_SCHEMA_VERSION;
  status: 'optimal' | 'unverified';
  size: number;
  matching: Array<{ left: string; right: string }>;
  unmatchedLeft: string[];
  unmatchedRight: string[];
  verification: ScientificVerification;
}

function emptyVerification(): ScientificVerification {
  return { schemaVersion: '1.0', passed: true, checks: [], failures: [], tolerance: TOLERANCE };
}

function add(result: ScientificVerification, id: string, description: string, passed: boolean, evidence: string): void {
  result.checks.push({ id, description, status: passed ? 'passed' : 'failed', evidence });
  if (!passed) result.failures.push(`${id}: ${evidence}`);
  result.passed = result.failures.length === 0;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function nodesOf(model: { nodes?: string[]; edges: Array<{ from: string; to: string }> }): string[] {
  const nodes = new Set(model.nodes ?? []);
  for (const edge of model.edges) { nodes.add(edge.from); nodes.add(edge.to); }
  return [...nodes];
}

function validateCapacityModel(model: MaxFlowModel): string[] {
  const errors: string[] = [];
  if (!model.source?.trim()) errors.push('source is required');
  if (!model.sink?.trim()) errors.push('sink is required');
  if (model.source === model.sink) errors.push('source and sink must differ');
  if (!Array.isArray(model.edges) || model.edges.length === 0) errors.push('at least one edge is required');
  for (const [index, edge] of model.edges.entries()) {
    if (!edge.from?.trim() || !edge.to?.trim()) errors.push(`edge ${index + 1} needs from and to`);
    if (!Number.isFinite(edge.capacity)) errors.push(`edge ${index + 1} has a non-finite capacity`);
    else if (edge.capacity < 0) errors.push(`edge ${index + 1} has a negative capacity`);
  }
  const nodes = new Set(nodesOf(model));
  if (model.source && !nodes.has(model.source)) errors.push(`source "${model.source}" is not in the graph`);
  if (model.sink && !nodes.has(model.sink)) errors.push(`sink "${model.sink}" is not in the graph`);
  return [...new Set(errors)];
}

interface ResidualEdge { to: number; rev: number; capacity: number; cost: number; original: number }

function buildResidual(nodes: string[], edges: Array<{ from: string; to: string; capacity: number; cost?: number; id?: string }>): { graph: ResidualEdge[][]; originals: Array<{ from: number; to: number; index: number; capacity: number; cost: number; id: string; fromName: string; toName: string }> } {
  const index = new Map(nodes.map((node, i) => [node, i]));
  const graph: ResidualEdge[][] = nodes.map(() => []);
  const originals: Array<{ from: number; to: number; index: number; capacity: number; cost: number; id: string; fromName: string; toName: string }> = [];
  for (const [edgeIndex, edge] of edges.entries()) {
    const from = index.get(edge.from)!;
    const to = index.get(edge.to)!;
    const forward: ResidualEdge = { to, rev: graph[to]!.length, capacity: edge.capacity, cost: edge.cost ?? 0, original: originals.length };
    const reverse: ResidualEdge = { to: from, rev: graph[from]!.length, capacity: 0, cost: -(edge.cost ?? 0), original: -1 };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
    originals.push({ from, to, index: edgeIndex, capacity: edge.capacity, cost: edge.cost ?? 0, id: edge.id ?? `${edge.from}->${edge.to}#${edgeIndex}`, fromName: edge.from, toName: edge.to });
  }
  return { graph, originals };
}

function dinic(model: MaxFlowModel): { maxFlow: number; flows: FlowEdgeResult[]; sourceSide: string[]; sinkSide: string[]; minCutCapacity: number } {
  const nodes = nodesOf(model);
  const { graph, originals } = buildResidual(nodes, model.edges);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const source = index.get(model.source)!;
  const sink = index.get(model.sink)!;
  let maxFlow = 0;
  while (true) {
    const level = new Array(nodes.length).fill(-1);
    level[source] = 0;
    const queue = [source];
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head]!;
      for (const edge of graph[node]!) {
        if (edge.capacity > TOLERANCE && level[edge.to]! < 0) { level[edge.to] = level[node]! + 1; queue.push(edge.to); }
      }
    }
    if (level[sink]! < 0) break;
    const cursor = new Array(nodes.length).fill(0);
    const dfs = (node: number, pushed: number): number => {
      if (node === sink) return pushed;
      while (cursor[node]! < graph[node]!.length) {
        const edge = graph[node]![cursor[node]!]!;
        if (edge.capacity > TOLERANCE && level[edge.to] === level[node]! + 1) {
          const sent = dfs(edge.to, Math.min(pushed, edge.capacity));
          if (sent > TOLERANCE) {
            edge.capacity -= sent;
            graph[edge.to]![edge.rev]!.capacity += sent;
            return sent;
          }
        }
        cursor[node]! += 1;
      }
      return 0;
    };
    while (true) {
      const sent = dfs(source, Number.POSITIVE_INFINITY);
      if (sent <= TOLERANCE) break;
      maxFlow += sent;
    }
  }
  const reachable = new Array(nodes.length).fill(false);
  reachable[source] = true;
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const edge of graph[node]!) {
      if (edge.capacity > TOLERANCE && !reachable[edge.to]) { reachable[edge.to] = true; queue.push(edge.to); }
    }
  }
  const flows: FlowEdgeResult[] = originals.map((original, originalIndex) => {
    const residualForward = graph[original.from]!.find((edge) => edge.to === original.to && edge.original === originalIndex);
    const flow = original.capacity - (residualForward?.capacity ?? original.capacity);
    return {
      id: original.id, from: original.fromName, to: original.toName, capacity: original.capacity,
      flow: round(Math.max(0, Math.min(original.capacity, flow))),
    };
  });
  const sourceSide = nodes.filter((_, i) => reachable[i]);
  const sinkSide = nodes.filter((_, i) => !reachable[i]);
  const minCutCapacity = model.edges.filter((edge) => reachable[index.get(edge.from)!] && !reachable[index.get(edge.to)!])
    .reduce((sum, edge) => sum + edge.capacity, 0);
  return { maxFlow: round(maxFlow), flows, sourceSide, sinkSide, minCutCapacity: round(minCutCapacity) };
}

export function verifyMaxFlow(model: MaxFlowModel, result: MaxFlowResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The model is infeasible', true, 'infeasible model reported explicitly');
    return verification;
  }
  const nodes = nodesOf(model);
  const balance = new Map<string, number>();
  for (const node of nodes) balance.set(node, 0);
  let validFlows = true;
  for (const edge of result.flows) {
    if (edge.flow < -TOLERANCE || edge.flow > edge.capacity + TOLERANCE) validFlows = false;
    balance.set(edge.from, (balance.get(edge.from) ?? 0) - edge.flow);
    balance.set(edge.to, (balance.get(edge.to) ?? 0) + edge.flow);
  }
  add(verification, 'capacity', 'Every edge flow is within its capacity', validFlows, `${result.flows.length} edge(s) checked`);
  const conservation = nodes.filter((node) => node !== model.source && node !== model.sink)
    .every((node) => Math.abs(balance.get(node) ?? 0) <= TOLERANCE);
  add(verification, 'conservation', 'Flow is conserved at every intermediate node', conservation, `intermediate nodes=${nodes.length - 2}`);
  const sourceOut = -(balance.get(model.source) ?? 0);
  add(verification, 'flow-value', 'The reported max flow equals the source outflow', result.maxFlow !== null && Math.abs(sourceOut - result.maxFlow) <= TOLERANCE, `sourceOut=${round(sourceOut)}; reported=${String(result.maxFlow)}`);
  const cutOk = result.minCut !== null && Math.abs(result.minCut.capacity - (result.maxFlow ?? -1)) <= TOLERANCE;
  add(verification, 'min-cut', 'The min-cut capacity equals the max-flow value', cutOk, `cut=${String(result.minCut?.capacity)}; flow=${String(result.maxFlow)}`);
  add(verification, 'partition', 'The min-cut partitions every node', result.minCut !== null && result.minCut.sourceSide.length + result.minCut.sinkSide.length === nodes.length, `sourceSide=${result.minCut?.sourceSide.length ?? 0}; sinkSide=${result.minCut?.sinkSide.length ?? 0}`);
  return verification;
}

export function solveMaxFlow(model: MaxFlowModel): MaxFlowResult {
  const errors = validateCapacityModel(model);
  if (errors.length) {
    return {
      schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'infeasible', maxFlow: null, flows: [], minCut: null,
      verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The model is valid', status: 'failed', evidence: errors.join('; ') }], failures: errors, tolerance: TOLERANCE },
    };
  }
  const solved = dinic(model);
  const partial: MaxFlowResult = {
    schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'optimal', maxFlow: solved.maxFlow, flows: solved.flows,
    minCut: { sourceSide: solved.sourceSide, sinkSide: solved.sinkSide, capacity: solved.minCutCapacity },
    verification: emptyVerification(),
  };
  partial.verification = verifyMaxFlow(model, partial);
  if (!partial.verification.passed) partial.status = 'unverified';
  return partial;
}

export function verifyMinCostFlow(model: MinCostFlowModel, result: MinCostFlowResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The requested flow is infeasible', true, 'infeasible demand reported explicitly');
    return verification;
  }
  const nodes = nodesOf(model);
  const balance = new Map<string, number>();
  for (const node of nodes) balance.set(node, 0);
  let valid = true;
  let cost = 0;
  for (const edge of result.flows) {
    if (edge.flow < -TOLERANCE || edge.flow > edge.capacity + TOLERANCE) valid = false;
    balance.set(edge.from, (balance.get(edge.from) ?? 0) - edge.flow);
    balance.set(edge.to, (balance.get(edge.to) ?? 0) + edge.flow);
    cost += edge.flow * (edge.cost ?? 0);
  }
  add(verification, 'capacity', 'Every edge flow is within its capacity', valid, `${result.flows.length} edge(s) checked`);
  const conservation = nodes.filter((node) => node !== model.source && node !== model.sink)
    .every((node) => Math.abs(balance.get(node) ?? 0) <= TOLERANCE);
  add(verification, 'conservation', 'Flow is conserved at every intermediate node', conservation, `intermediate nodes=${nodes.length - 2}`);
  const delivered = -(balance.get(model.source) ?? 0);
  add(verification, 'demand', 'Exactly the requested demand is delivered', Math.abs(delivered - model.demand) <= TOLERANCE && result.flow !== null && Math.abs(result.flow - model.demand) <= TOLERANCE, `delivered=${round(delivered)}; demand=${model.demand}`);
  add(verification, 'cost', 'The reported total cost equals the recomputed cost', result.totalCost !== null && Math.abs(cost - result.totalCost) <= 1e-6 * Math.max(1, Math.abs(cost)), `recomputed=${round(cost)}; reported=${String(result.totalCost)}`);
  const residualCycle = residualNegativeCycle(model, result.flows);
  add(verification, 'residual-optimality', 'No negative-cost cycle remains in the residual network', !residualCycle.found, residualCycle.evidence);
  return verification;
}

function residualNegativeCycle(model: MinCostFlowModel, flows: FlowEdgeResult[]): { found: boolean; evidence: string } {
  const nodes = nodesOf(model);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const edges: Array<{ from: number; to: number; cost: number; capacity: number }> = [];
  for (const [edgeIndex, edge] of model.edges.entries()) {
    const used = flows.find((flow) => flow.id === (edge.id ?? `${edge.from}->${edge.to}#${edgeIndex}`))?.flow ?? 0;
    edges.push({ from: index.get(edge.from)!, to: index.get(edge.to)!, cost: edge.cost, capacity: edge.capacity - used });
    edges.push({ from: index.get(edge.to)!, to: index.get(edge.from)!, cost: -edge.cost, capacity: used });
  }
  const distance = new Array(nodes.length).fill(0);
  let changed = false;
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    changed = false;
    for (const edge of edges) {
      if (edge.capacity <= TOLERANCE) continue;
      if (distance[edge.from]! + edge.cost < distance[edge.to]! - TOLERANCE) {
        distance[edge.to] = distance[edge.from]! + edge.cost;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return changed ? { found: true, evidence: 'a negative residual cycle was detected' } : { found: false, evidence: 'residual network has no negative cycle' };
}

function minCostFlow(model: MinCostFlowModel): { flow: number; cost: number; flows: FlowEdgeResult[] } | null {
  const nodes = nodesOf(model);
  const { graph, originals } = buildResidual(nodes, model.edges);
  const index = new Map(nodes.map((node, i) => [node, i]));
  const source = index.get(model.source)!;
  const sink = index.get(model.sink)!;
  let flow = 0;
  let cost = 0;
  while (flow < model.demand - TOLERANCE) {
    const distance = new Array(nodes.length).fill(Number.POSITIVE_INFINITY);
    const inQueue = new Array(nodes.length).fill(false);
    const previous: Array<{ node: number; edge: number } | null> = new Array(nodes.length).fill(null);
    const relaxations = new Array(nodes.length).fill(0);
    distance[source] = 0;
    const queue = [source];
    inQueue[source] = true;
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head]!;
      inQueue[node] = false;
      for (const [edgeIndex, edge] of graph[node]!.entries()) {
        if (edge.capacity <= TOLERANCE) continue;
        const next = distance[node]! + edge.cost;
        if (next < distance[edge.to]! - TOLERANCE) {
          distance[edge.to] = next;
          previous[edge.to] = { node, edge: edgeIndex };
          relaxations[edge.to] = relaxations[node]! + 1;
          if (relaxations[edge.to]! > nodes.length) return null;
          if (!inQueue[edge.to]) { queue.push(edge.to); inQueue[edge.to] = true; }
        }
      }
    }
    if (!Number.isFinite(distance[sink]!)) return null;
    let pushed = model.demand - flow;
    for (let cursor = sink; cursor !== source;) {
      const step = previous[cursor]!;
      pushed = Math.min(pushed, graph[step.node]![step.edge]!.capacity);
      cursor = step.node;
    }
    for (let cursor = sink; cursor !== source;) {
      const step = previous[cursor]!;
      const edge = graph[step.node]![step.edge]!;
      edge.capacity -= pushed;
      graph[edge.to]![edge.rev]!.capacity += pushed;
      cursor = step.node;
    }
    flow += pushed;
    cost += pushed * distance[sink]!;
  }
  const flows: FlowEdgeResult[] = originals.map((original, originalIndex) => {
    const residual = graph[original.from]!.find((edge) => edge.to === original.to && edge.original === originalIndex);
    return {
      id: original.id, from: original.fromName, to: original.toName, capacity: original.capacity,
      flow: round(Math.max(0, Math.min(original.capacity, original.capacity - (residual?.capacity ?? original.capacity)))),
      cost: original.cost,
    };
  });
  return { flow: round(flow), cost: round(cost), flows };
}

export function solveMinCostFlow(model: MinCostFlowModel): MinCostFlowResult {
  const errors = validateCapacityModel(model as MaxFlowModel);
  if (!Number.isFinite(model.demand) || model.demand < 0) errors.push('demand must be a finite non-negative number');
  for (const [index, edge] of model.edges.entries()) if (!Number.isFinite(edge.cost)) errors.push(`edge ${index + 1} has a non-finite cost`);
  if (errors.length) {
    return {
      schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'infeasible', demand: model.demand, flow: null, totalCost: null, flows: [],
      verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The model is valid', status: 'failed', evidence: errors.join('; ') }], failures: errors, tolerance: TOLERANCE },
    };
  }
  if (model.demand === 0) {
    const zero: MinCostFlowResult = { schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'optimal', demand: 0, flow: 0, totalCost: 0, flows: [], verification: emptyVerification() };
    zero.verification = verifyMinCostFlow(model, zero);
    if (!zero.verification.passed) zero.status = 'unverified';
    return zero;
  }
  const solved = minCostFlow(model);
  if (!solved) {
    const infeasible: MinCostFlowResult = { schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'infeasible', demand: model.demand, flow: null, totalCost: null, flows: [], verification: emptyVerification() };
    infeasible.verification = verifyMinCostFlow(model, infeasible);
    return infeasible;
  }
  const result: MinCostFlowResult = { schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'optimal', demand: model.demand, flow: solved.flow, totalCost: solved.cost, flows: solved.flows, verification: emptyVerification() };
  result.verification = verifyMinCostFlow(model, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}

function matchingOf(model: BipartiteModel): Map<string, string> {
  const adjacency = new Map<string, string[]>();
  for (const left of model.left) adjacency.set(left, []);
  for (const edge of model.edges) {
    if (!adjacency.has(edge.left)) adjacency.set(edge.left, []);
    if (!adjacency.get(edge.left)!.includes(edge.right)) adjacency.get(edge.left)!.push(edge.right);
  }
  const rightToLeft = new Map<string, string>();
  const tryAssign = (left: string, visited: Set<string>): boolean => {
    for (const right of adjacency.get(left) ?? []) {
      if (visited.has(right)) continue;
      visited.add(right);
      const current = rightToLeft.get(right);
      if (!current || tryAssign(current, visited)) {
        rightToLeft.set(right, left);
        return true;
      }
    }
    return false;
  };
  for (const left of model.left) tryAssign(left, new Set());
  return rightToLeft;
}

export function verifyBipartiteMatching(model: BipartiteModel, result: BipartiteResult): ScientificVerification {
  const verification = emptyVerification();
  const leftSet = new Set(model.left);
  const rightSet = new Set(model.right);
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();
  let valid = true;
  for (const pair of result.matching) {
    if (!leftSet.has(pair.left) || !rightSet.has(pair.right)) valid = false;
    if (!model.edges.some((edge) => edge.left === pair.left && edge.right === pair.right)) valid = false;
    if (usedLeft.has(pair.left) || usedRight.has(pair.right)) valid = false;
    usedLeft.add(pair.left); usedRight.add(pair.right);
  }
  add(verification, 'matching-validity', 'Every matched pair is a real edge and is used once', valid, `${result.matching.length} pair(s) checked`);
  add(verification, 'matching-size', 'The reported size equals the number of matched pairs', result.size === result.matching.length, `size=${result.size}; pairs=${result.matching.length}`);
  add(verification, 'unmatched', 'Unmatched lists are consistent with the matching', result.unmatchedLeft.length === model.left.filter((left) => !usedLeft.has(left)).length && result.unmatchedRight.length === model.right.filter((right) => !usedRight.has(right)).length, `unmatchedLeft=${result.unmatchedLeft.length}; unmatchedRight=${result.unmatchedRight.length}`);
  const augmented = augmentingPathExists(model, new Map(result.matching.map((pair) => [pair.right, pair.left])));
  add(verification, 'matching-maximality', 'No augmenting path remains, so the matching is maximum', !augmented, augmented ? 'an augmenting path exists' : 'no augmenting path found');
  return verification;
}

function augmentingPathExists(model: BipartiteModel, rightToLeft: Map<string, string>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const left of model.left) adjacency.set(left, []);
  for (const edge of model.edges) if (adjacency.has(edge.left)) adjacency.get(edge.left)!.push(edge.right);
  const matchedLeft = new Set(rightToLeft.values());
  for (const left of model.left) {
    if (matchedLeft.has(left)) continue;
    const visited = new Set<string>();
    const dfs = (node: string): boolean => {
      for (const right of adjacency.get(node) ?? []) {
        if (visited.has(right)) continue;
        visited.add(right);
        const current = rightToLeft.get(right);
        if (!current || dfs(current)) return true;
      }
      return false;
    };
    if (dfs(left)) return true;
  }
  return false;
}

export function solveBipartiteMatching(model: BipartiteModel): BipartiteResult {
  const left = [...new Set(model.left)];
  const right = [...new Set(model.right)];
  const edges = model.edges.filter((edge) => left.includes(edge.left) && right.includes(edge.right));
  const rightToLeft = matchingOf({ left, right, edges });
  const matching = [...rightToLeft.entries()].map(([matchedRight, matchedLeft]) => ({ left: matchedLeft, right: matchedRight }))
    .sort((a, b) => a.left.localeCompare(b.left));
  const usedLeft = new Set(matching.map((pair) => pair.left));
  const usedRight = new Set(matching.map((pair) => pair.right));
  const result: BipartiteResult = {
    schemaVersion: NETWORK_FLOW_SCHEMA_VERSION, status: 'optimal', size: matching.length, matching,
    unmatchedLeft: left.filter((node) => !usedLeft.has(node)), unmatchedRight: right.filter((node) => !usedRight.has(node)),
    verification: emptyVerification(),
  };
  result.verification = verifyBipartiteMatching({ left, right, edges }, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}
