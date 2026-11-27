/**
 * WORA OS — graph search engines.
 *
 * Real Dijkstra and A* implementations over an explicit weighted graph. A*
 * results are checked against an independent Dijkstra baseline before the
 * result is marked optimal, so an inadmissible heuristic cannot silently
 * produce an unverified claim.
 */
export const GRAPH_SCHEMA_VERSION = '1.0';

export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
  id?: string;
}

export interface GraphModel {
  nodes?: string[];
  edges: GraphEdge[];
  start: string;
  goal: string;
  directed?: boolean;
  heuristic?: Record<string, number>;
  algorithm?: 'auto' | 'dijkstra' | 'a_star';
}

export interface GraphCheck {
  id: string;
  description: string;
  status: 'passed' | 'failed';
  evidence: string;
}

export interface GraphResult {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  status: 'optimal' | 'no_path' | 'not_verified';
  algorithm: 'dijkstra' | 'a_star';
  path: string[];
  edgeIds: string[];
  totalCost: number | null;
  baselineCost: number | null;
  expanded: number;
  visited: string[];
  heuristicUsed: boolean;
  verification: { passed: boolean; checks: GraphCheck[]; failures: string[] };
  limitations: string[];
}

interface QueueItem { node: string; priority: number; cost: number }

class MinHeap {
  private items: QueueItem[] = [];

  get size(): number { return this.items.length; }

  push(item: QueueItem): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent]!.priority <= this.items[index]!.priority) break;
      [this.items[parent], this.items[index]] = [this.items[index]!, this.items[parent]!];
      index = parent;
    }
  }

  pop(): QueueItem | undefined {
    if (!this.items.length) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.items[left]!.priority < this.items[smallest]!.priority) smallest = left;
        if (right < this.items.length && this.items[right]!.priority < this.items[smallest]!.priority) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest]!, this.items[index]!];
        index = smallest;
      }
    }
    return top;
  }
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

function adjacency(model: GraphModel): Map<string, Array<{ to: string; weight: number; id: string }>> {
  const graph = new Map<string, Array<{ to: string; weight: number; id: string }>>();
  const ensure = (node: string) => {
    if (!graph.has(node)) graph.set(node, []);
    return graph.get(node)!;
  };
  for (const node of model.nodes ?? []) ensure(node);
  model.edges.forEach((edge, index) => {
    const id = edge.id ?? `${edge.from}->${edge.to}#${index}`;
    ensure(edge.from).push({ to: edge.to, weight: edge.weight, id });
    if (model.directed !== true) ensure(edge.to).push({ to: edge.from, weight: edge.weight, id: `${id}:reverse` });
  });
  return graph;
}

function validateModel(model: GraphModel): string[] {
  const errors: string[] = [];
  if (!model.start?.trim()) errors.push('start node is required');
  if (!model.goal?.trim()) errors.push('goal node is required');
  if (!Array.isArray(model.edges) || model.edges.length === 0) errors.push('at least one weighted edge is required');
  const nodes = new Set(model.nodes ?? []);
  for (const edge of model.edges ?? []) {
    if (!edge.from?.trim() || !edge.to?.trim()) errors.push('every edge needs a from and to node');
    if (!Number.isFinite(edge.weight)) errors.push(`edge ${edge.from}->${edge.to} has a non-finite weight`);
    else if (edge.weight < 0) errors.push(`edge ${edge.from}->${edge.to} has a negative weight; Dijkstra/A* require non-negative weights`);
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  if (model.start && !nodes.has(model.start)) errors.push(`start node "${model.start}" is not present in the graph`);
  if (model.goal && !nodes.has(model.goal)) errors.push(`goal node "${model.goal}" is not present in the graph`);
  for (const [node, value] of Object.entries(model.heuristic ?? {})) {
    if (!nodes.has(node)) errors.push(`heuristic node "${node}" is not present in the graph`);
    if (!Number.isFinite(value) || value < 0) errors.push(`heuristic for "${node}" must be finite and non-negative`);
  }
  return [...new Set(errors)];
}

function search(
  model: GraphModel,
  algorithm: 'dijkstra' | 'a_star',
): { path: string[]; edgeIds: string[]; cost: number | null; expanded: number; visited: string[] } {
  const graph = adjacency(model);
  const heuristic = algorithm === 'a_star' ? (model.heuristic ?? {}) : {};
  const start = model.start;
  const goal = model.goal;
  const distance = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, { node: string; edgeId: string }>();
  const open = new MinHeap();
  const visited: string[] = [];
  open.push({ node: start, priority: heuristic[start] ?? 0, cost: 0 });
  let expanded = 0;

  while (open.size) {
    const current = open.pop()!;
    if (current.cost !== distance.get(current.node)) continue;
    expanded += 1;
    visited.push(current.node);
    if (current.node === goal) break;
    for (const edge of graph.get(current.node) ?? []) {
      const nextCost = current.cost + edge.weight;
      if (nextCost < (distance.get(edge.to) ?? Infinity)) {
        distance.set(edge.to, nextCost);
        previous.set(edge.to, { node: current.node, edgeId: edge.id });
        open.push({ node: edge.to, priority: nextCost + (heuristic[edge.to] ?? 0), cost: nextCost });
      }
    }
  }

  if (!distance.has(goal)) return { path: [], edgeIds: [], cost: null, expanded, visited };
  const path: string[] = [goal];
  const edgeIds: string[] = [];
  let cursor = goal;
  while (cursor !== start) {
    const step = previous.get(cursor);
    if (!step) return { path: [], edgeIds: [], cost: null, expanded, visited };
    edgeIds.unshift(step.edgeId);
    path.unshift(step.node);
    cursor = step.node;
  }
  return { path, edgeIds, cost: round(distance.get(goal)!), expanded, visited };
}

function verify(model: GraphModel, result: Omit<GraphResult, 'verification'>, baseline: { path: string[]; cost: number | null }): GraphResult['verification'] {
  const checks: GraphCheck[] = [];
  const failures: string[] = [];
  const add = (id: string, description: string, passed: boolean, evidence: string) => {
    checks.push({ id, description, status: passed ? 'passed' : 'failed', evidence });
    if (!passed) failures.push(`${id}: ${evidence}`);
  };

  if (result.status === 'no_path') {
    add('path-exists', 'A path was found or the absence is reported', baseline.cost === null, `algorithm=${result.algorithm}; baselineCost=${String(baseline.cost)}`);
  } else {
    add('path-endpoints', 'The path starts at the requested start and ends at the goal', result.path[0] === model.start && result.path[result.path.length - 1] === model.goal, `path=${result.path.join(' → ')}`);
    let continuity = true;
    let recomputed = 0;
    for (let index = 0; index < result.path.length - 1; index++) {
      const from = result.path[index]!;
      const to = result.path[index + 1]!;
      const candidates = model.edges.filter((edge) =>
        (edge.from === from && edge.to === to) || (model.directed !== true && edge.from === to && edge.to === from));
      if (!candidates.length) { continuity = false; break; }
      const chosen = candidates.sort((a, b) => a.weight - b.weight)[0]!;
      recomputed += chosen.weight;
    }
    add('path-continuity', 'Every consecutive path pair is a real graph edge', continuity, continuity ? 'all edges exist' : 'a path step has no matching edge');
    add('path-cost', 'The reported cost equals the sum of the traversed edge weights', result.totalCost !== null && Math.abs(round(recomputed) - result.totalCost) <= 1e-6, `recomputed=${round(recomputed)}; reported=${String(result.totalCost)}`);
    if (result.algorithm === 'a_star') {
      const optimal = baseline.cost !== null && result.totalCost !== null && Math.abs(baseline.cost - result.totalCost) <= 1e-6;
      add('a-star-optimality', 'A* matches an independent Dijkstra baseline', optimal, `aStar=${String(result.totalCost)}; dijkstra=${String(baseline.cost)}`);
    } else {
      add('dijkstra-optimality', 'Dijkstra completed over non-negative edges', true, 'non-negative weights validated before search');
    }
    add('edge-trace', 'Every path step has a recorded edge identifier', result.edgeIds.length === Math.max(0, result.path.length - 1), `edgeIds=${result.edgeIds.length}`);
  }
  return { passed: failures.length === 0, checks, failures };
}

export function solveShortestPath(model: GraphModel): GraphResult {
  const errors = validateModel(model);
  if (errors.length) throw new Error(`Invalid graph: ${errors.join('; ')}`);
  const requested = model.algorithm ?? 'auto';
  const heuristicUsed = requested !== 'dijkstra' && Object.keys(model.heuristic ?? {}).length > 0;
  const algorithm: 'dijkstra' | 'a_star' = requested === 'dijkstra' ? 'dijkstra' : requested === 'a_star' ? 'a_star' : heuristicUsed ? 'a_star' : 'dijkstra';
  const baseline = search(model, 'dijkstra');
  const result = algorithm === 'a_star' ? search(model, 'a_star') : baseline;
  const status = result.cost === null ? 'no_path' : 'optimal';
  const partial: Omit<GraphResult, 'verification'> = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    status,
    algorithm,
    path: result.path,
    edgeIds: result.edgeIds,
    totalCost: result.cost,
    baselineCost: baseline.cost,
    expanded: result.expanded,
    visited: result.visited,
    heuristicUsed,
    limitations: [
      'Non-negative edge weights only; negative edges require a different algorithm and are rejected.',
      'A* optimality is verified against an independent Dijkstra baseline; an inadmissible heuristic is reported as a failure.',
      'The path is optimal for the supplied graph, not proof that the graph model is correct.',
    ],
  };
  const verification = verify(model, partial, baseline);
  return { ...partial, status: verification.passed ? status : 'not_verified', verification };
}
