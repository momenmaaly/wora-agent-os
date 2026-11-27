import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '..');

test('deployment: API origin and single-writer contract is enforced at build time', () => {
  const output = execFileSync(process.execPath, ['scripts/check-api-contract.mjs'], { cwd: clientRoot, encoding: 'utf8' });
  assert.match(output, /contract check passed/u);
});
