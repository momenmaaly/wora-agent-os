import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIndependently } from './independent-verification.js';

test('a valid forecast passes contract, property, security and integrity checks', () => {
  const result = verifyIndependently({
    tool: 'forecast.linear', toolOk: true,
    output: { projections: [{ step: 1, point: 10, bandLow: 8, bandHigh: 12 }, { step: 2, point: 11, bandLow: 9, bandHigh: 13 }] },
  });
  assert.equal(result.passed, true);
  assert.ok(result.checks.some((check) => check.id === 'output-contract' && check.status === 'passed'));
  assert.ok(result.checks.some((check) => check.id === 'property-forecast' && check.status === 'passed'));
  assert.ok(result.checks.some((check) => check.id === 'secret-leak' && check.status === 'passed'));
  assert.equal(result.artifactDigest.length, 64);
});

test('a broken contract or property fails independently of the executor', () => {
  const broken = verifyIndependently({ tool: 'or.employee_schedule', toolOk: true, output: { feasible: true, totalCost: -1, assignments: [], perShift: [{ meetsDemand: false }] } });
  assert.equal(broken.passed, false);
  assert.ok(broken.failures.some((failure) => /property-schedule/.test(failure)));
  const nullOutput = verifyIndependently({ tool: 'system.diagnostics', toolOk: true, output: null });
  assert.equal(nullOutput.passed, false);
  assert.ok(nullOutput.failures.some((failure) => /output-contract/.test(failure)));
});

test('credential signatures in output fail closed', () => {
  const leaked = verifyIndependently({ tool: 'web.fetch_read', toolOk: true, output: { status: 200, content: 'token ghp_abcdefghijklmnopqrstuvwxyz123456' } });
  assert.equal(leaked.passed, false);
  assert.ok(leaked.failures.some((failure) => /secret leak/i.test(failure)));
  assert.ok(leaked.checks.some((check) => check.id === 'secret-leak' && check.status === 'failed'));
});

test('executor failure is recorded and cannot be reported as passed', () => {
  const failed = verifyIndependently({ tool: 'host.exec', toolOk: false, output: null, error: 'process failed' });
  assert.equal(failed.passed, false);
  assert.ok(failed.checks.some((check) => check.id === 'executor-result' && check.status === 'failed'));
  assert.ok(failed.failures.includes('process failed'));
});

test('a successful but empty output fails the independent quality check', () => {
  const empty = verifyIndependently({ tool: 'text.extract_summary', toolOk: true, output: { summary: '' } });
  assert.equal(empty.passed, false);
  assert.ok(empty.checks.some((check) => check.id === 'output-quality' && check.status === 'failed'));
});

test('adversarial false success — an LP claim with a wrong objective and violated constraint is rejected', () => {
  const result = verifyIndependently({
    tool: 'or.solve_lp', toolOk: true,
    toolInput: { sense: 'minimize', objective: [{ var: 'x', coeff: 1 }], constraints: [{ name: 'min', terms: [{ var: 'x', coeff: 1 }], op: '>=', rhs: 2 }], bounds: { x: { lower: 0 } } },
    output: { status: 'Optimal', objectiveValue: 999, variables: { x: 1 }, verification: { passed: true }, lp: 'forged' },
  });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.id === 'recompute-lp' && check.status === 'failed'));
  assert.ok(result.failures.some((failure) => /objective-recompute|constraint-1/u.test(failure)));
});

test('adversarial false success — an assignment with duplicate rows and a wrong total is rejected', () => {
  const result = verifyIndependently({
    tool: 'or.assignment', toolOk: true,
    toolInput: { costMatrix: [[12, 7, 9], [8, 14, 5], [6, 9, 11]] },
    output: {
      assignments: [
        { row: 0, col: 0, rowLabel: 'r0', colLabel: 'c0', cost: 12 },
        { row: 0, col: 1, rowLabel: 'r0', colLabel: 'c1', cost: 7 },
      ],
      totalCost: 1, dummyAssignments: 1, size: 3, verification: { passed: true },
    },
  });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.id === 'recompute-assignment' && check.status === 'failed'));
  assert.ok(result.failures.some((failure) => /assignment-unique|assignment-total/u.test(failure)));
});

test('adversarial false success — a schedule that violates maxAssignments and demand is rejected', () => {
  const result = verifyIndependently({
    tool: 'or.employee_schedule', toolOk: true,
    toolInput: {
      employees: [{ id: 'e1', name: 'E1', hourlyCost: 10, availability: ['s1', 's2'], maxAssignments: 1 }],
      shifts: [{ id: 's1', name: 'S1', demand: 1 }, { id: 's2', name: 'S2', demand: 1 }],
    },
    output: {
      status: 'Optimal', feasible: true, totalCost: 10,
      assignments: [
        { employeeId: 'e1', employeeName: 'E1', shiftId: 's1', shiftName: 'S1', hourlyCost: 10 },
        { employeeId: 'e1', employeeName: 'E1', shiftId: 's2', shiftName: 'S2', hourlyCost: 10 },
      ],
      perShift: [{ shiftId: 's1', shiftName: 'S1', demand: 1, assigned: 1, meetsDemand: true, employees: ['E1'] }, { shiftId: 's2', shiftName: 'S2', demand: 1, assigned: 1, meetsDemand: true, employees: ['E1'] }],
      unassignedEmployees: [], validation: [], verification: { passed: true }, lp: 'forged',
    },
  });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.id === 'recompute-schedule' && check.status === 'failed'));
  assert.ok(result.failures.some((failure) => /workload-e1|schedule-cost/u.test(failure)));
});

test('adversarial false success — a VRP route over capacity and a wrong distance is rejected', () => {
  const result = verifyIndependently({
    tool: 'routing.vrp', toolOk: true,
    toolInput: {
      depots: [{ id: 'd', x: 0, y: 0 }],
      customers: [{ id: 'a', x: 1, y: 0, demand: 6 }, { id: 'b', x: 2, y: 0, demand: 6 }],
      vehicles: [{ id: 'v', capacity: 10 }],
    },
    output: {
      schemaVersion: '1.0', status: 'feasible', method: 'clarke-wright-savings', exact: false,
      routes: [{ vehicleId: 'v', depotId: 'd', stops: ['a', 'b'], load: 12, distance: 999 }],
      totalDistance: 999, verification: { passed: true }, limitations: [],
    },
  });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.id === 'recompute-vrp' && check.status === 'failed'));
  assert.ok(result.failures.some((failure) => /capacity|distance/u.test(failure)));
});

test('adversarial false success — a TSP tour that omits a point and misreports cost is rejected', () => {
  const result = verifyIndependently({
    tool: 'routing.tsp', toolOk: true,
    toolInput: { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }] },
    output: { schemaVersion: '1.0', status: 'optimal', method: 'held-karp', exact: true, tour: ['a', 'b', 'a'], cost: 1, lowerBound: 1, verification: { passed: true }, limitations: [] },
  });
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.id === 'recompute-tsp' && check.status === 'failed'));
});
