/**
 * WORA extensions — Git repository adapter.
 *
 * A marketplace is a Git repository (or an explicitly allow-listed local
 * directory for tests). The adapter clones into a throw-away directory with
 * terminal prompts disabled and, when a credential is configured, passes it
 * through the child environment (never argv) so it cannot be read from the
 * process list. Only bounded manifest files are read; symlinks are skipped.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MAX_MANIFEST_BYTES, MAX_INSTRUCTIONS_CHARS, type PackageKind } from './manifest.js';

const execFileAsync = promisify(execFile);

export class MarketplaceError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
    this.name = 'MarketplaceError';
  }
}

export interface RepositoryFile {
  kind: PackageKind;
  manifestPath: string;
  manifestSource: string;
  instructions: string;
  sourceSha: string;
}

export interface RepositorySnapshot {
  commit: string | null;
  files: RepositoryFile[];
  log: string[];
}

export interface FetchOptions {
  url: string;
  ref: string;
  refType: 'branch' | 'tag' | 'commit';
  subPath?: string;
  secret?: string | null;
  timeoutMs?: number;
}

const MANIFEST_NAME: Record<PackageKind, string> = { skill: 'skill.json', plugin: 'plugin.json' };

/** Only https remotes, file:// URLs and allow-listed local directories are accepted. */
export function classifySource(url: string): 'git' | 'local' {
  if (/^file:\/\//iu.test(url)) return 'git';
  if (/^https:\/\/[\w.-]+(?:[/:][^\s]*)?$/iu.test(url)) return 'git';
  if (/^ssh:\/\//iu.test(url)) throw new MarketplaceError('UNSUPPORTED_TRANSPORT', 'SSH marketplaces are not supported; use an HTTPS URL');
  if (/^git@/u.test(url)) throw new MarketplaceError('UNSUPPORTED_TRANSPORT', 'SSH marketplaces are not supported; use an HTTPS URL');
  if (path.isAbsolute(url)) return 'local';
  throw new MarketplaceError('INVALID_REPOSITORY', 'Repository URLs must be https://, file:// or an absolute local path');
}

function allowedLocalRoots(): string[] {
  const configured = (process.env['WORA_EXTENSIONS_LOCAL_ROOTS'] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return configured.map((root) => path.resolve(root));
}

function assertLocalRoot(target: string): void {
  const resolved = path.resolve(target);
  const allowed = allowedLocalRoots();
  if (!allowed.some((root) => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new MarketplaceError('LOCAL_ROOT_DENIED', 'Local marketplace paths must be inside WORA_EXTENSIONS_LOCAL_ROOTS');
  }
}

function safeJoin(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new MarketplaceError('INVALID_PATH', 'Path escapes the repository root');
  return target;
}

function walk(root: string, maxDepth = 5, limit = 2_000): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth || out.length >= limit) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try { entries = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>; } catch { return; }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      let stat: ReturnType<typeof lstatSync>;
      try { stat = lstatSync(full); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(full, depth + 1);
      else if (stat.isFile()) out.push(full);
    }
  };
  visit(root, 0);
  return out;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Discover `wora/skills/<name>/skill.json`, `wora/plugins/<name>/plugin.json` (root-level folders also accepted). */
export function discoverManifests(root: string): RepositoryFile[] {
  const found: RepositoryFile[] = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (!/^(?:wora\/)?(?:skills|plugins)\/(?:[A-Za-z0-9._-]+\/)*(?:skill|plugin)\.json$/u.test(rel)) continue;
    const kind: PackageKind = rel.endsWith('plugin.json') ? 'plugin' : 'skill';
    const expected = rel.startsWith('wora/plugins/') || rel.startsWith('plugins/') ? 'plugin' : rel.startsWith('wora/skills/') || rel.startsWith('skills/') ? 'skill' : kind;
    if (kind !== expected) continue;
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(file); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) continue;
    const manifestSource = readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    const instructions = ['SKILL.md', 'INSTRUCTIONS.md', 'instructions.md']
      .map((name) => path.join(dir, name))
      .filter((candidate) => {
        try { const info = lstatSync(candidate); return info.isFile() && info.size <= MAX_INSTRUCTIONS_CHARS * 4; } catch { return false; }
      })
      .map((candidate) => readFileSync(candidate, 'utf8').slice(0, MAX_INSTRUCTIONS_CHARS))[0] ?? '';
    found.push({ kind, manifestPath: rel, manifestSource, instructions, sourceSha: '' });
    if (found.length >= 200) break;
  }
  return found;
}

async function runGit(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: options.env,
      windowsHide: true,
    });
  } catch (error) {
    const failure = error as { killed?: boolean; stderr?: string; message?: string };
    const message = (failure.stderr ?? failure.message ?? 'git failed').toString().slice(0, 800);
    throw new MarketplaceError(failure.killed ? 'GIT_TIMEOUT' : 'GIT_FAILED', message, Boolean(failure.killed));
  }
}

function credentialEnv(secret: string | null | undefined): Record<string, string> {
  if (!secret) return {};
  const basic = Buffer.from(`x-access-token:${secret}`, 'utf8').toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/** Clone a Git repository (depth 1) and return the manifests it publishes. */
export async function fetchGitRepository(options: FetchOptions): Promise<RepositorySnapshot> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wora-market-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'wora-git-home-'));
  const log: string[] = [];
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '/bin/echo',
      ...credentialEnv(options.secret),
    };
    await runGit(['init', '--quiet'], { cwd: dir, env, timeoutMs });
    await runGit(['remote', 'add', 'origin', options.url], { cwd: dir, env, timeoutMs });
    const ref = options.refType === 'branch' ? options.ref : options.ref;
    log.push(`fetch ${options.refType} ${ref}`);
    await runGit(['fetch', '--depth', '1', '--no-tags', 'origin', ref], { cwd: dir, env, timeoutMs });
    await runGit(['checkout', '--quiet', 'FETCH_HEAD'], { cwd: dir, env, timeoutMs });
    const { stdout } = await runGit(['rev-parse', 'HEAD'], { cwd: dir, env, timeoutMs: 5_000 });
    const commit = stdout.trim().slice(0, 64);
    const root = options.subPath ? safeJoin(dir, options.subPath) : dir;
    const files = discoverManifests(root).map((file) => ({ ...file, sourceSha: commit }));
    log.push(`commit ${commit.slice(0, 12)} · ${files.length} manifest(s)`);
    return { commit, files, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/** Read an allow-listed local directory (used by tests and local development). */
export function fetchLocalRepository(options: FetchOptions): RepositorySnapshot {
  if (!path.isAbsolute(options.url)) throw new MarketplaceError('INVALID_REPOSITORY', 'Local paths must be absolute');
  assertLocalRoot(options.url);
  const root = options.subPath ? safeJoin(path.resolve(options.url), options.subPath) : path.resolve(options.url);
  const files = discoverManifests(root);
  return { commit: null, files, log: [`local ${root} · ${files.length} manifest(s)`] };
}

export async function fetchRepository(options: FetchOptions): Promise<RepositorySnapshot & { provider: 'git' | 'local' }> {
  const provider = classifySource(options.url);
  if (provider === 'local') {
    const snapshot = fetchLocalRepository(options);
    return { ...snapshot, provider };
  }
  const snapshot = await fetchGitRepository(options);
  return { ...snapshot, provider };
}

export function manifestNameFor(kind: PackageKind): string {
  return MANIFEST_NAME[kind];
}
