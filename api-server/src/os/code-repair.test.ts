import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = mkdtempSync(path.join(os.tmpdir(), 'wora-repair-'));
process.env['WORA_OS_DB'] = ':memory:';
process.env['WORA_WORKSPACE'] = path.join(TMP, 'workspace');
process.env['NODE_ENV'] = 'test';
const { repairRepository, inspectRepository } = await import('./code-repair.js');
const { workspacePath } = await import('./workspace.js');
const { resetOsDbForTests } = await import('./db.js');
const WS = 'repair-workspace';
const BUG = `export function add(a, b) { return a - b; }\n`;
const FIXED = `export function add(a, b) { return a + b; }\n`;
const TEST = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../calc.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n`;
const PATCH = `--- a/calc.js\n+++ b/calc.js\n@@ -1 +1 @@\n-export function add(a, b) { return a - b; }\n+export function add(a, b) { return a + b; }\n`;

function repo(name: string, branch = 'feature/repair'): string {
  const root = path.join(workspacePath(WS), name);
  mkdirSync(path.join(root, 'test'), { recursive: true });
  writeFileSync(path.join(root, 'calc.js'), BUG);
  writeFileSync(path.join(root, 'test', 'calc.test.mjs'), TEST);
  if (branch) {
    mkdirSync(path.join(root, '.git'), { recursive: true });
    writeFileSync(path.join(root, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  }
  return root;
}

before(() => { mkdirSync(process.env['WORA_WORKSPACE']!, { recursive: true }); });
after(() => { resetOsDbForTests(); rmSync(TMP, { recursive: true, force: true }); });

test('inspects an existing repository without following outside paths', () => {
  repo('inspect-me');
  const inventory = inspectRepository(WS, 'inspect-me');
  assert.equal(inventory.branch, 'feature/repair');
  assert.ok(inventory.files.includes('calc.js'));
  assert.ok(inventory.files.includes('test/calc.test.mjs'));
  assert.throws(() => inspectRepository(WS, '../outside'), /escapes|outside|workspace/i);
});

test('reproduces a seeded defect, applies a minimal patch, verifies tests and produces a diff', async () => {
  const root = repo('buggy');
  const result = await repairRepository({
    workspaceId: WS, repoPath: 'buggy', defect: 'add() subtracts instead of adding', patch: PATCH,
    testPath: 'test/calc.test.mjs', regressionPath: 'test', actor: 'repair-test',
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.stage, 'complete');
  assert.equal(result.sourceUnchanged, true);
  assert.equal(readFileSync(path.join(root, 'calc.js'), 'utf8'), BUG, 'source repository must remain untouched');
  assert.match(result.diff, /a\/calc\.js/);
  assert.match(result.diff, /\+export function add/);
  assert.ok(result.checks.some((check) => check.id === 'defect-reproduced' && check.status === 'passed'));
  assert.ok(result.checks.some((check) => check.id === 'targeted-tests' && check.status === 'passed'));
  assert.ok(result.checks.some((check) => check.id === 'regression-tests' && check.status === 'passed'));
  assert.ok(result.checks.some((check) => check.id === 'source-untouched' && check.status === 'passed'));
});

test('a patch that does not fix the test fails verification and leaves the source untouched', async () => {
  const root = repo('still-broken');
  const badPatch = PATCH.replace('+export function add(a, b) { return a + b; }', '+export function add(a, b) { return a * b; }');
  const result = await repairRepository({
    workspaceId: WS, repoPath: 'still-broken', defect: 'bad patch', patch: badPatch,
    testPath: 'test/calc.test.mjs', regressionPath: 'test', actor: 'repair-test',
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /Targeted tests failed/);
  assert.equal(readFileSync(path.join(root, 'calc.js'), 'utf8'), BUG);
  assert.ok(result.checks.some((check) => check.id === 'targeted-tests' && check.status === 'failed'));
});

test('a defect that cannot be reproduced is refused before a patch is applied', async () => {
  const root = repo('already-green');
  writeFileSync(path.join(root, 'calc.js'), FIXED);
  const result = await repairRepository({
    workspaceId: WS, repoPath: 'already-green', defect: 'no defect', patch: PATCH,
    testPath: 'test/calc.test.mjs', actor: 'repair-test',
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /not reproduced/);
  assert.equal(readFileSync(path.join(root, 'calc.js'), 'utf8'), FIXED);
});

test('protected branches and protected paths are refused', async () => {
  repo('protected', 'main');
  const protectedBranch = await repairRepository({
    workspaceId: WS, repoPath: 'protected', defect: 'protected', patch: PATCH,
    testPath: 'test/calc.test.mjs', actor: 'repair-test',
  });
  assert.equal(protectedBranch.ok, false);
  assert.match(protectedBranch.error ?? '', /protected branch/);

  repo('unsafe-patch', 'feature/unsafe');
  const unsafe = await repairRepository({
    workspaceId: WS, repoPath: 'unsafe-patch', defect: 'unsafe', patch: `--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-secret=old\n+secret=new\n`,
    testPath: 'test/calc.test.mjs', actor: 'repair-test',
  });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error ?? '', /protected path/);
});
