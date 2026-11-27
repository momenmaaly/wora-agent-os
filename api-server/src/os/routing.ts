/**
 * WORA OS — routing and combinatorial optimization.
 *
 * TSP uses exact Held-Karp dynamic programming for small instances and an
 * explicit nearest-neighbour + 2-opt heuristic for larger ones. VRP uses
 * Clarke–Wright savings with depot assignment and capacity checks. Results are
 * always labelled optimal, feasible/approximate or infeasible; a heuristic is
 * never reported as globally optimal.
 */
import type { ScientificVerification } from './scientific-verification.js';

export const ROUTING_SCHEMA_VERSION = '1.0';
const TOLERANCE = 1e-9;

export interface RoutePoint { id: string; x: number; y: number }
export interface TspModel {
  points?: RoutePoint[];
  distanceMatrix?: number[][];
  labels?: string[];
  start?: string;
  exactLimit?: number;
}
export interface TspResult {
  schemaVersion: typeof ROUTING_SCHEMA_VERSION;
  status: 'optimal' | 'approximate' | 'infeasible' | 'unverified';
  method: 'held-karp' | 'nearest-neighbor+2-opt' | 'nearest-neighbor';
  exact: boolean;
  tour: string[];
  cost: number | null;
  lowerBound: number | null;
  verification: ScientificVerification;
  limitations: string[];
}

export interface VrpDepot { id: string; x: number; y: number }
export interface VrpCustomer { id: string; x: number; y: number; demand: number; depot?: string }
export interface VrpVehicle { id: string; capacity: number; depot?: string }
export interface VrpModel { depots: VrpDepot[]; customers: VrpCustomer[]; vehicles: VrpVehicle[] }
export interface VrpRoute {
  vehicleId: string;
  depotId: string;
  stops: string[];
  load: number;
  distance: number;
}
export interface VrpResult {
  schemaVersion: typeof ROUTING_SCHEMA_VERSION;
  status: 'feasible' | 'infeasible' | 'unverified';
  method: 'clarke-wright-savings';
  exact: false;
  routes: VrpRoute[];
  totalDistance: number | null;
  verification: ScientificVerification;
  limitations: string[];
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
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function normalizeTsp(model: TspModel): { labels: string[]; matrix: number[][]; startIndex: number } | { error: string } {
  if (Array.isArray(model.distanceMatrix)) {
    const matrix = model.distanceMatrix;
    const n = matrix.length;
    if (n === 0) return { error: 'distance matrix must not be empty' };
    if (!matrix.every((row) => Array.isArray(row) && row.length === n && row.every((value) => Number.isFinite(value) && value >= 0))) {
      return { error: 'distance matrix must be square with finite non-negative values' };
    }
    const labels = model.labels?.length === n ? [...model.labels] : Array.from({ length: n }, (_, i) => `n${i + 1}`);
    if (new Set(labels).size !== n) return { error: 'distance matrix labels must be unique' };
    const startIndex = model.start ? labels.indexOf(model.start) : 0;
    if (startIndex < 0) return { error: `start "${model.start}" is not a matrix label` };
    return { labels, matrix, startIndex };
  }
  const points = model.points ?? [];
  if (!points.length) return { error: 'points or a distance matrix is required' };
  if (new Set(points.map((point) => point.id)).size !== points.length) return { error: 'point ids must be unique' };
  if (!points.every((point) => point.id.trim() && Number.isFinite(point.x) && Number.isFinite(point.y))) return { error: 'every point needs an id and finite coordinates' };
  const labels = points.map((point) => point.id);
  const matrix = points.map((a) => points.map((b) => distance(a, b)));
  const startIndex = model.start ? labels.indexOf(model.start) : 0;
  if (startIndex < 0) return { error: `start "${model.start}" is not a point id` };
  return { labels, matrix, startIndex };
}

function heldKarp(labels: string[], matrix: number[][], start: number): { tour: number[]; cost: number } {
  const n = labels.length;
  if (n === 1) return { tour: [start], cost: 0 };
  const full = (1 << n) - 1;
  const dp: number[][] = Array.from({ length: 1 << n }, () => new Array(n).fill(Number.POSITIVE_INFINITY));
  const parent: number[][] = Array.from({ length: 1 << n }, () => new Array(n).fill(-1));
  dp[1 << start]![start] = 0;
  for (let mask = 0; mask <= full; mask++) {
    if (!(mask & (1 << start))) continue;
    for (let end = 0; end < n; end++) {
      const current = dp[mask]![end]!;
      if (!Number.isFinite(current)) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const candidate = current + matrix[end]![next]!;
        if (candidate < dp[nextMask]![next]!) {
          dp[nextMask]![next] = candidate;
          parent[nextMask]![next] = end;
        }
      }
    }
  }
  let best = Number.POSITIVE_INFINITY;
  let end = -1;
  for (let node = 0; node < n; node++) {
    if (node === start) continue;
    const candidate = dp[full]![node]! + matrix[node]![start]!;
    if (candidate < best) { best = candidate; end = node; }
  }
  if (end < 0) return { tour: [start], cost: 0 };
  const tour: number[] = [];
  let mask = full;
  let cursor = end;
  while (cursor !== -1 && cursor !== start) {
    tour.push(cursor);
    const previous = parent[mask]![cursor]!;
    mask ^= 1 << cursor;
    cursor = previous;
  }
  tour.push(start);
  tour.reverse();
  return { tour, cost: best };
}

function nearestNeighbor(matrix: number[][], start: number): number[] {
  const n = matrix.length;
  const visited = new Set<number>([start]);
  const tour = [start];
  let current = start;
  while (visited.size < n) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let next = 0; next < n; next++) {
      if (visited.has(next)) continue;
      if (matrix[current]![next]! < bestDistance) { bestDistance = matrix[current]![next]!; best = next; }
    }
    if (best < 0) break;
    visited.add(best);
    tour.push(best);
    current = best;
  }
  return tour;
}

function twoOpt(matrix: number[][], tour: number[]): number[] {
  const n = tour.length;
  if (n < 4) return tour;
  let improved = true;
  let best = [...tour];
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = best[i - 1]!;
        const b = best[i]!;
        const c = best[j]!;
        const d = j + 1 < n ? best[j + 1]! : best[0]!;
        const before = matrix[a]![b]! + matrix[c]![d]!;
        const after = matrix[a]![c]! + matrix[b]![d]!;
        if (after + TOLERANCE < before) {
          const segment = best.slice(i, j + 1).reverse();
          best = [...best.slice(0, i), ...segment, ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }
  return best;
}

function tourCost(matrix: number[][], tour: number[]): number {
  if (tour.length <= 1) return 0;
  let cost = 0;
  for (let i = 0; i < tour.length; i++) cost += matrix[tour[i]!]![tour[(i + 1) % tour.length]!]!;
  return round(cost);
}

function mstLowerBound(matrix: number[][]): number {
  const n = matrix.length;
  if (n <= 1) return 0;
  const inTree = new Array(n).fill(false);
  const key = new Array(n).fill(Number.POSITIVE_INFINITY);
  key[0] = 0;
  let total = 0;
  for (let count = 0; count < n; count++) {
    let node = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (node < 0 || key[i]! < key[node]!)) node = i;
    if (node < 0) break;
    inTree[node] = true;
    total += key[node]!;
    for (let next = 0; next < n; next++) {
      if (!inTree[next] && matrix[node]![next]! < key[next]!) key[next] = matrix[node]![next]!;
    }
  }
  return round(total);
}

export function verifyTsp(model: TspModel, result: TspResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The TSP model is infeasible', true, 'invalid model reported explicitly');
    return verification;
  }
  const normalized = normalizeTsp(model);
  if ('error' in normalized) {
    add(verification, 'model', 'The TSP model is valid', false, normalized.error);
    return verification;
  }
  const { labels, matrix, startIndex } = normalized;
  const n = labels.length;
  const tour = result.tour.map((label) => labels.indexOf(label));
  add(verification, 'tour-size', 'The tour visits every node exactly once', tour.length === n && new Set(tour).size === n && tour.every((index) => index >= 0), `tour=${result.tour.join(' → ')}`);
  add(verification, 'tour-start', 'The tour starts at the requested node', tour[0] === startIndex, `start=${labels[startIndex]}; tourStart=${result.tour[0] ?? 'none'}`);
  const recomputed = tour.length === n ? tourCost(matrix, tour) : null;
  add(verification, 'tour-cost', 'The reported cost equals the recomputed cycle cost', recomputed !== null && result.cost !== null && Math.abs(recomputed - result.cost) <= 1e-6, `recomputed=${String(recomputed)}; reported=${String(result.cost)}`);
  add(verification, 'cost-bound', 'The tour cost is at least the independent MST lower bound', recomputed !== null && result.lowerBound !== null && recomputed + 1e-6 >= result.lowerBound, `cost=${String(recomputed)}; lowerBound=${String(result.lowerBound)}`);
  if (result.exact && n <= 8) {
    const brute = bruteForceTsp(matrix, startIndex);
    add(verification, 'exact-optimum', 'The exact tour cost matches an independent brute-force enumeration', brute !== null && result.cost !== null && Math.abs(brute - result.cost) <= 1e-6, `brute=${String(brute)}; reported=${String(result.cost)}`);
  }
  if (!result.exact) add(verification, 'approximation-label', 'A heuristic result is labelled approximate, not optimal', result.status === 'approximate', `status=${result.status}`);
  return verification;
}

function bruteForceTsp(matrix: number[][], start: number): number | null {
  const n = matrix.length;
  if (n > 8) return null;
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== start);
  let best = Number.POSITIVE_INFINITY;
  const permute = (items: number[], prefix: number[]) => {
    if (!items.length) {
      let cost = 0;
      let previous = start;
      for (const node of prefix) { cost += matrix[previous]![node]!; previous = node; }
      cost += matrix[previous]![start]!;
      best = Math.min(best, cost);
      return;
    }
    for (let i = 0; i < items.length; i++) permute([...items.slice(0, i), ...items.slice(i + 1)], [...prefix, items[i]!]);
  };
  permute(rest, []);
  return round(best);
}

export function solveTsp(model: TspModel): TspResult {
  const normalized = normalizeTsp(model);
  if ('error' in normalized) {
    return { schemaVersion: ROUTING_SCHEMA_VERSION, status: 'infeasible', method: 'held-karp', exact: false, tour: [], cost: null, lowerBound: null, verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The TSP model is valid', status: 'failed', evidence: normalized.error }], failures: [normalized.error], tolerance: TOLERANCE }, limitations: ['Invalid model was not solved.'] };
  }
  const { labels, matrix, startIndex } = normalized;
  const n = labels.length;
  const symmetric = matrix.every((row, i) => row.every((value, j) => Math.abs(value - matrix[j]![i]!) <= 1e-9));
  const exactLimit = Math.min(14, Math.max(2, Math.floor(model.exactLimit ?? 12)));
  const exact = n <= exactLimit;
  let indices: number[];
  let method: TspResult['method'];
  if (exact) {
    indices = heldKarp(labels, matrix, startIndex).tour;
    method = 'held-karp';
  } else {
    indices = nearestNeighbor(matrix, startIndex);
    method = symmetric ? 'nearest-neighbor+2-opt' : 'nearest-neighbor';
    if (symmetric) indices = twoOpt(matrix, indices);
  }
  const tour = indices.map((index) => labels[index]!);
  const cost = tourCost(matrix, indices);
  const result: TspResult = {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    status: exact ? 'optimal' : 'approximate',
    method, exact, tour, cost,
    lowerBound: symmetric ? mstLowerBound(matrix) : null,
    verification: emptyVerification(),
    limitations: exact
      ? ['Exact Held-Karp is limited to small instances; runtime grows exponentially.']
      : ['Nearest-neighbour + 2-opt is a heuristic; no global optimality is claimed.', 'The MST lower bound is not a proof of the optimality gap.'],
  };
  result.verification = verifyTsp(model, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}

function normalizeVrp(model: VrpModel): { depots: VrpDepot[]; customers: VrpCustomer[]; vehicles: VrpVehicle[] } | { error: string } {
  const depots = model.depots ?? [];
  const customers = model.customers ?? [];
  const vehicles = model.vehicles ?? [];
  if (!depots.length) return { error: 'at least one depot is required' };
  if (!customers.length) return { error: 'at least one customer is required' };
  if (!vehicles.length) return { error: 'at least one vehicle is required' };
  if (new Set(depots.map((depot) => depot.id)).size !== depots.length) return { error: 'depot ids must be unique' };
  if (new Set(customers.map((customer) => customer.id)).size !== customers.length) return { error: 'customer ids must be unique' };
  if (new Set(vehicles.map((vehicle) => vehicle.id)).size !== vehicles.length) return { error: 'vehicle ids must be unique' };
  if (!depots.every((depot) => depot.id.trim() && Number.isFinite(depot.x) && Number.isFinite(depot.y))) return { error: 'every depot needs an id and finite coordinates' };
  if (!customers.every((customer) => customer.id.trim() && Number.isFinite(customer.x) && Number.isFinite(customer.y) && Number.isFinite(customer.demand) && customer.demand >= 0)) return { error: 'every customer needs an id, finite coordinates and a non-negative demand' };
  if (!vehicles.every((vehicle) => vehicle.id.trim() && Number.isFinite(vehicle.capacity) && vehicle.capacity > 0)) return { error: 'every vehicle needs an id and a positive capacity' };
  const depotIds = new Set(depots.map((depot) => depot.id));
  if (customers.some((customer) => customer.depot && !depotIds.has(customer.depot))) return { error: 'a customer references an unknown depot' };
  if (vehicles.some((vehicle) => vehicle.depot && !depotIds.has(vehicle.depot))) return { error: 'a vehicle references an unknown depot' };
  return { depots, customers, vehicles };
}

function nearestDepot(customer: VrpCustomer, depots: VrpDepot[]): VrpDepot {
  if (customer.depot) return depots.find((depot) => depot.id === customer.depot)!;
  return [...depots].sort((a, b) => distance(a, customer) - distance(b, customer))[0]!;
}

function solveDepotRoutes(depot: VrpDepot, customers: VrpCustomer[], vehicles: VrpVehicle[]): VrpRoute[] | null {
  const capacity = Math.max(...vehicles.map((vehicle) => vehicle.capacity));
  const routes: Array<{ stops: VrpCustomer[]; load: number }> = customers.map((customer) => ({ stops: [customer], load: customer.demand }));
  if (routes.some((route) => route.load > capacity + TOLERANCE)) return null;
  const savings: Array<{ i: number; j: number; saving: number }> = [];
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i]!;
      const b = customers[j]!;
      savings.push({ i, j, saving: distance(depot, a) + distance(depot, b) - distance(a, b) });
    }
  }
  savings.sort((a, b) => b.saving - a.saving);
  const routeOf = new Map<string, number>();
  routes.forEach((route, index) => routeOf.set(route.stops[0]!.id, index));
  for (const { i, j } of savings) {
    const a = customers[i]!;
    const b = customers[j]!;
    const ri = routeOf.get(a.id);
    const rj = routeOf.get(b.id);
    if (ri === undefined || rj === undefined || ri === rj) continue;
    const left = routes[ri]!;
    const right = routes[rj]!;
    if (left.load + right.load > capacity + TOLERANCE) continue;
    const aAtEnd = left.stops[left.stops.length - 1]!.id === a.id;
    const aAtStart = left.stops[0]!.id === a.id;
    const bAtEnd = right.stops[right.stops.length - 1]!.id === b.id;
    const bAtStart = right.stops[0]!.id === b.id;
    let merged: VrpCustomer[] | null = null;
    if (aAtEnd && bAtStart) merged = [...left.stops, ...right.stops];
    else if (aAtStart && bAtEnd) merged = [...right.stops, ...left.stops];
    else if (aAtEnd && bAtEnd) merged = [...left.stops, ...right.stops.slice().reverse()];
    else if (aAtStart && bAtStart) merged = [...left.stops.slice().reverse(), ...right.stops];
    if (!merged) continue;
    routes[ri] = { stops: merged, load: left.load + right.load };
    routes.splice(rj, 1);
    routeOf.clear();
    routes.forEach((route, index) => route.stops.forEach((stop) => routeOf.set(stop.id, index)));
  }
  const sortedVehicles = [...vehicles].sort((a, b) => b.capacity - a.capacity);
  if (routes.length > sortedVehicles.length) return null;
  const assigned: VrpRoute[] = [];
  for (const [index, route] of routes.entries()) {
    const vehicle = sortedVehicles[index]!;
    if (route.load > vehicle.capacity + TOLERANCE) return null;
    let routeDistance = distance(depot, route.stops[0]!);
    for (let i = 0; i < route.stops.length - 1; i++) routeDistance += distance(route.stops[i]!, route.stops[i + 1]!);
    routeDistance += distance(route.stops[route.stops.length - 1]!, depot);
    assigned.push({ vehicleId: vehicle.id, depotId: depot.id, stops: route.stops.map((stop) => stop.id), load: round(route.load), distance: round(routeDistance) });
  }
  return assigned;
}

export function verifyVrp(model: VrpModel, result: VrpResult): ScientificVerification {
  const verification = emptyVerification();
  if (result.status === 'infeasible') {
    add(verification, 'model-status', 'The VRP model is infeasible', true, 'infeasible model reported explicitly');
    return verification;
  }
  const normalized = normalizeVrp(model);
  if ('error' in normalized) {
    add(verification, 'model', 'The VRP model is valid', false, normalized.error);
    return verification;
  }
  const { depots, customers, vehicles } = normalized;
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const depotById = new Map(depots.map((depot) => [depot.id, depot]));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const seen = new Set<string>();
  let valid = true;
  let total = 0;
  for (const route of result.routes) {
    const depot = depotById.get(route.depotId);
    const vehicle = vehicleById.get(route.vehicleId);
    if (!depot || !vehicle) valid = false;
    if (route.stops.length === 0) valid = false;
    let load = 0;
    let routeDistance = 0;
    let previous: { x: number; y: number } = depot ?? { x: 0, y: 0 };
    for (const stopId of route.stops) {
      const customer = byId.get(stopId);
      if (!customer || seen.has(stopId)) { valid = false; continue; }
      seen.add(stopId);
      load += customer.demand;
      routeDistance += distance(previous, customer);
      previous = customer;
    }
    if (depot) routeDistance += distance(previous, depot);
    if (vehicle && load > vehicle.capacity + TOLERANCE) valid = false;
    if (Math.abs(load - route.load) > 1e-6 || Math.abs(routeDistance - route.distance) > 1e-6) valid = false;
    total += routeDistance;
  }
  add(verification, 'customer-coverage', 'Every customer appears in exactly one route', seen.size === customers.length && valid, `served=${seen.size}; customers=${customers.length}`);
  add(verification, 'capacity', 'Every route load is within its vehicle capacity', result.routes.every((route) => {
    const vehicle = vehicleById.get(route.vehicleId);
    return vehicle ? route.load <= vehicle.capacity + TOLERANCE : false;
  }), `${result.routes.length} route(s) checked`);
  add(verification, 'route-shape', 'Every route starts and ends at its depot', result.routes.every((route) => route.stops.length > 0 && depotById.has(route.depotId)), `${result.routes.length} route(s) checked`);
  add(verification, 'distance', 'The reported total distance equals the recomputed distance', result.totalDistance !== null && Math.abs(round(total) - result.totalDistance) <= 1e-6, `recomputed=${round(total)}; reported=${String(result.totalDistance)}`);
  add(verification, 'approximation-label', 'A heuristic VRP result is labelled feasible/approximate, not optimal', result.status === 'feasible' && result.exact === false, `status=${result.status}; exact=${result.exact}`);
  return verification;
}

export function solveVrp(model: VrpModel): VrpResult {
  const normalized = normalizeVrp(model);
  if ('error' in normalized) {
    return { schemaVersion: ROUTING_SCHEMA_VERSION, status: 'infeasible', method: 'clarke-wright-savings', exact: false, routes: [], totalDistance: null, verification: { schemaVersion: '1.0', passed: false, checks: [{ id: 'model-validation', description: 'The VRP model is valid', status: 'failed', evidence: normalized.error }], failures: [normalized.error], tolerance: TOLERANCE }, limitations: ['Invalid model was not solved.'] };
  }
  const { depots, customers, vehicles } = normalized;
  const byDepot = new Map<string, VrpCustomer[]>();
  for (const customer of customers) {
    const depot = nearestDepot(customer, depots);
    if (!byDepot.has(depot.id)) byDepot.set(depot.id, []);
    byDepot.get(depot.id)!.push(customer);
  }
  const routes: VrpRoute[] = [];
  for (const depot of depots) {
    const assignedCustomers = byDepot.get(depot.id) ?? [];
    if (!assignedCustomers.length) continue;
    const depotVehicles = vehicles.filter((vehicle) => !vehicle.depot || vehicle.depot === depot.id);
    const solved = solveDepotRoutes(depot, assignedCustomers, depotVehicles);
    if (!solved) {
      return { schemaVersion: ROUTING_SCHEMA_VERSION, status: 'infeasible', method: 'clarke-wright-savings', exact: false, routes: [], totalDistance: null, verification: { schemaVersion: '1.0', passed: true, checks: [{ id: 'capacity', description: 'Capacity and vehicle feasibility are checked', status: 'passed', evidence: `depot=${depot.id} cannot serve its customers` }], failures: [], tolerance: TOLERANCE }, limitations: ['The instance is infeasible for the supplied vehicles or capacities.'] };
    }
    routes.push(...solved);
  }
  const totalDistance = round(routes.reduce((sum, route) => sum + route.distance, 0));
  const result: VrpResult = { schemaVersion: ROUTING_SCHEMA_VERSION, status: 'feasible', method: 'clarke-wright-savings', exact: false, routes, totalDistance, verification: emptyVerification(), limitations: ['Clarke–Wright savings is a heuristic; no global optimality is claimed.', 'Customer-to-depot assignment is nearest-depot, not jointly optimized.'] };
  result.verification = verifyVrp(model, result);
  if (!result.verification.passed) result.status = 'unverified';
  return result;
}
