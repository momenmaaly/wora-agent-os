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
