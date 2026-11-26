/**
 * WORA code-repair workflow.
 *
 * The engine never edits the source repository. It copies the repository to a
 * temporary workspace, requires the defect test to fail before the patch,
 * applies a bounded unified diff, runs the targeted and regression tests,
 * independently checks the diff, and deletes the temporary copy. A failed
 * verification therefore rolls back by discarding the copy.
 */
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { audit, getOsDb, newId } from './db.js';
import { resolveInWorkspace, workspacePath } from './workspace.js';
import { redactSecrets } from './secrets.js';

const MAX_PATCH_BYTES = 256_000;
const MAX_PATCH_FILES = 12;
const MAX_PATCH_LINES = 1_500;
const PROTECTED_PATHS = [/^\.git(?:\/|$)/u, /^node_modules(?:\/|$)/u, /(?:^|\/)\.env(?:\.|$)/u, /(?:^|\/)(?:id_rsa|id_ed25519|\.npmrc|\.pypirc)$/u, /\.(?:pem|key|p12|pfx)$/iu];
const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'release']);

export interface CodeRepairInput {
  workspaceId: string;
  repoPath: string;
  defect: string;
  patch: string;
  testPath: string;
  regressionPath?: string;
  actor: string;
}

export interface RepairCheck { id: string; status: 'passed' | 'failed'; evidence: string; }
export interface CodeRepairResult {
  id: string;
  ok: boolean;
  stage: 'validation' | 'reproduce' | 'apply' | 'test' | 'regression' | 'verify' | 'complete';
  sourceUnchanged: true;
  branch: string | null;
  diff: string;
  checks: RepairCheck[];
  evidence: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

function safeRelative(value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`${label} must be a relative path inside the repository`);
  }
  return value.replace(/\\/gu, '/');
}

function branchOf(repo: string): string | null {
  try {
    const head = readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8').trim();
    const match = /^ref: refs\/heads\/(.+)$/u.exec(head);
    return match?.[1] ?? null;
  } catch { return null; }
}

function validatePatch(patch: string): string[] {
  const issues: string[] = [];
  if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) issues.push('patch is too large');
  const lines = patch.split(/\r?\n/u);
  if (lines.length > MAX_PATCH_LINES) issues.push('patch has too many lines');
  const files = new Set<string>();
  for (const line of lines) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const raw = line.slice(4).trim().split(/\s+/u)[0] ?? '';
      const normalized = raw.replace(/^[ab]\//u, '');
      if (!normalized || path.isAbsolute(normalized) || normalized.split('/').includes('..')) { issues.push(`unsafe patch path: ${raw.slice(0, 100)}`); continue; }
      files.add(normalized);
      if (PROTECTED_PATHS.some((pattern) => pattern.test(normalized))) issues.push(`protected path in patch: ${normalized}`);
    }
    if (line.startsWith('Binary files ')) issues.push('binary patches are not accepted');
  }
  if (files.size > MAX_PATCH_FILES) issues.push(`patch touches ${files.size} files (limit ${MAX_PATCH_FILES})`);
  if (!files.size) issues.push('patch has no file headers');
  return [...new Set(issues)];
}

async function run(command: string, args: string[], options: { cwd: string; timeout: number; input?: string }): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 1_048_576, env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'test' } }, (error, stdout, stderr) => {
      const err = error as (NodeJS.ErrnoException & { code?: number; killed?: boolean }) | null;
      resolve({
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout ?? ''), stderr: String(stderr ?? ''),
        timedOut: Boolean(err?.killed),
      });
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

async function runNodeTests(cwd: string, testPath: string): Promise<{ code: number; output: string; timedOut: boolean }> {
  const relative = safeRelative(testPath, 'testPath');
  const absolute = path.join(cwd, relative);
  const args = existsSync(absolute) && statSync(absolute).isDirectory() ? ['--test'] : ['--test', relative];
  const result = await run(process.execPath, args, { cwd, timeout: 30_000 });
  return { code: result.code, output: `${result.stdout}${result.stderr}`.trim().slice(0, 8_000), timedOut: result.timedOut };
}

export async function repairRepository(input: CodeRepairInput): Promise<CodeRepairResult> {
  const started = Date.now();
  const id = newId('rep');
  const checks: RepairCheck[] = [];
  const evidence: Record<string, unknown> = { defect: redactSecrets(input.defect).value.slice(0, 1_000), testPath: input.testPath };
  let diff = '';
  let stage: CodeRepairResult['stage'] = 'validation';
  let source = '';
  let branch: string | null = null;
  let temp = '';
  const finish = (ok: boolean, error?: string): CodeRepairResult => ({
    id, ok, stage, sourceUnchanged: true, branch, diff: redactSecrets(diff).value, checks, evidence,
    ...(error ? { error: redactSecrets(error).value.slice(0, 1_000) } : {}), durationMs: Date.now() - started,
  });
  try {
    source = resolveInWorkspace(input.workspaceId, input.repoPath);
    branch = branchOf(source);
    temp = path.join(workspacePath(input.workspaceId), '.repairs', id);
    if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error('Repository path is not a directory');
    if (branch && PROTECTED_BRANCHES.has(branch)) {
      throw new Error(`Refusing to repair protected branch "${branch}"; check out a feature branch first`);
    }
    if (!input.patch.trim()) throw new Error('A unified diff patch is required');
    const patchIssues = validatePatch(input.patch);
    checks.push({ id: 'patch-safety', status: patchIssues.length ? 'failed' : 'passed', evidence: patchIssues.join('; ') || 'bounded diff with relative paths only' });
    if (patchIssues.length) throw new Error(`Patch rejected: ${patchIssues.join('; ')}`);
    evidence['patchBytes'] = Buffer.byteLength(input.patch, 'utf8');

    mkdirSync(path.dirname(temp), { recursive: true });
    cpSync(source, temp, {
      recursive: true,
      filter: (candidate) => !/(?:^|\/)(?:\.git|node_modules|\.repairs)(?:\/|$)/u.test(candidate.slice(source.length)),
    });
    stage = 'reproduce';
    const before = await runNodeTests(temp, input.testPath);
    evidence['before'] = { code: before.code, timedOut: before.timedOut, output: before.output };
    checks.push({ id: 'defect-reproduced', status: before.code !== 0 ? 'passed' : 'failed', evidence: before.code !== 0 ? 'targeted test failed before the patch' : 'targeted test already passed; refusing to patch an unreproduced defect' });
    if (before.code === 0) throw new Error('Defect was not reproduced: the targeted test already passes');

    stage = 'apply';
    const applied = await run('patch', ['-p1', '--batch', '--forward'], { cwd: temp, timeout: 20_000, input: input.patch });
    evidence['apply'] = { code: applied.code, stdout: applied.stdout.slice(0, 2_000), stderr: applied.stderr.slice(0, 2_000) };
    checks.push({ id: 'patch-applied', status: applied.code === 0 ? 'passed' : 'failed', evidence: applied.code === 0 ? 'patch applied cleanly' : applied.stderr.slice(0, 500) });
    if (applied.code !== 0) throw new Error('Patch did not apply cleanly');

    stage = 'test';
    const after = await runNodeTests(temp, input.testPath);
    evidence['after'] = { code: after.code, timedOut: after.timedOut, output: after.output };
    checks.push({ id: 'targeted-tests', status: after.code === 0 ? 'passed' : 'failed', evidence: after.code === 0 ? 'targeted test passed after the patch' : after.output.slice(0, 500) });
    if (after.code !== 0) throw new Error('Targeted tests failed after the patch; the temporary copy was discarded');

    stage = 'regression';
    const regressionPath = input.regressionPath ?? (existsSync(path.join(temp, 'test')) ? 'test' : input.testPath);
    const regression = await runNodeTests(temp, regressionPath);
    evidence['regression'] = { path: regressionPath, code: regression.code, timedOut: regression.timedOut, output: regression.output };
    checks.push({ id: 'regression-tests', status: regression.code === 0 ? 'passed' : 'failed', evidence: regression.code === 0 ? `regression path ${regressionPath} passed` : regression.output.slice(0, 500) });
    if (regression.code !== 0) throw new Error('Regression tests failed after the patch');

    stage = 'verify';
    const diffRun = await run('diff', ['-ruN', '--exclude=.git', '--exclude=node_modules', '--exclude=.repairs', source, temp], { cwd: workspacePath(input.workspaceId), timeout: 20_000 });
    diff = `${diffRun.stdout}${diffRun.stderr}`.replaceAll(temp, '.').replaceAll(source, '.')
      .split(/\r?\n/u).filter((line) => !line.startsWith('diff -ruN')).join('\n')
      .replace(/^--- \.\/(.+?)(?:\t.*)?$/gmu, '--- a/$1')
      .replace(/^\+\+\+ \.\/(.+?)(?:\t.*)?$/gmu, '+++ b/$1');
    const redaction = redactSecrets(diff);
    evidence['diffBytes'] = Buffer.byteLength(diff, 'utf8');
    evidence['redactions'] = redaction.redactions;
    checks.push({ id: 'diff-produced', status: diff.trim() ? 'passed' : 'failed', evidence: diff.trim() ? 'non-empty unified diff produced' : 'no diff produced' });
    checks.push({ id: 'diff-secret-scan', status: redaction.redactions.length ? 'failed' : 'passed', evidence: redaction.redactions.length ? `redacted signatures: ${redaction.redactions.join(', ')}` : 'no credential signatures in the diff' });
    if (!diff.trim() || redaction.redactions.length) throw new Error('Independent diff verification failed');
    evidence['sourceBranch'] = branch;
    evidence['sourceUnchanged'] = true;
    stage = 'complete';
    checks.push({ id: 'source-untouched', status: 'passed', evidence: 'all work occurred in a temporary copy; the source repository was not modified' });
    audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'code.repair.complete', subject: id, detail: { repoPath: input.repoPath, testPath: input.testPath, branch, durationMs: Date.now() - started, checks: checks.map((check) => check.id) } });
    return finish(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Code repair failed';
    audit(getOsDb(), { workspaceId: input.workspaceId, actor: input.actor, action: 'code.repair.blocked', subject: id, detail: { repoPath: input.repoPath, stage, reason: message.slice(0, 300) } });
    return finish(false, message);
  } finally {
    if (temp) {
      try { rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

/** Read-only inventory used before a repair; never follows symlinks outside the repo. */
export function inspectRepository(workspaceId: string, repoPath: string): { path: string; files: string[]; packageJson: Record<string, unknown> | null; branch: string | null } {
  const root = resolveInWorkspace(workspaceId, repoPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Repository path is not a directory');
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || files.length >= 200) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.repairs') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) files.push(path.relative(root, full).replace(/\\/gu, '/'));
    }
  };
  walk(root, 0);
  let packageJson: Record<string, unknown> | null = null;
  try { packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>; } catch { packageJson = null; }
  return { path: inputPath(root, workspaceId), files: files.slice(0, 200), packageJson, branch: branchOf(root) };
}

function inputPath(root: string, workspaceId: string): string {
  return path.relative(workspacePath(workspaceId), root) || '.';
}
