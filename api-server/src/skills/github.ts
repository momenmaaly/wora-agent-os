import { Octokit } from '@octokit/rest';
import type { ImportedSkill } from '../../../shared/types/index.js';
import { extractSkill, MAX_METADATA_BYTES, SkillError, type Repository } from './metadata.js';

const API_ORIGIN = 'https://api.github.com';
const MAX_RESPONSE_BYTES = 144 * 1024;

export function createGitHubImporter(options: { token?: string; fetch?: typeof fetch } = {}) {
  const network = options.fetch ?? fetch;
  const boundedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== API_ORIGIN || (init?.method ?? 'GET') !== 'GET' || !/^\/repos\/[\w-]+\/[\w.-]+(?:\/contents\/skill\.json|\/readme)?$/u.test(url.pathname)) {
      throw new SkillError('GITHUB_UNAVAILABLE', 502);
    }
    const response = await network(input, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new SkillError('REPO_NOT_PUBLIC', 404);
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new SkillError('METADATA_TOO_LARGE', 422);
    }
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) throw new SkillError('METADATA_TOO_LARGE', 422);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };

  const github = new Octokit({
    ...(options.token ? { auth: options.token } : {}),
    baseUrl: API_ORIGIN,
    userAgent: 'Wora-Agent-OS skill-metadata',
    log: { debug() {}, info() {}, warn() {}, error() {} },
    request: { fetch: boundedFetch },
  });

  return async function importGitHub(repository: Repository, signal: AbortSignal) {
    const { owner, repo } = repository;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(7_500)]);
    const request = { signal: deadline };
    try {
      const { data: info } = await github.rest.repos.get({ owner, repo, request });
      if (info.private !== false || info.visibility !== 'public') throw new SkillError('REPO_NOT_PUBLIC', 404);
      const params = { owner, repo, request };
      let file: unknown;
      let kind: ImportedSkill['source']['kind'] = 'skill.json';
      try { file = (await github.rest.repos.getContent({ ...params, path: 'skill.json' })).data; }
      catch (error) {
        if (statusOf(error) !== 404) throw error;
        kind = 'readme';
        try { file = (await github.rest.repos.getReadme(params)).data; }
        catch (readmeError) {
          if (statusOf(readmeError) === 404) throw new SkillError('NO_SKILL_METADATA', 422);
          throw readmeError;
        }
      }
      deadline.throwIfAborted();
      const source = readFile(file, kind);
      return extractSkill(source.text, { kind, repository: repository.fullName, url: repository.url, path: source.path, sha: source.sha }, repository);
    } catch (error) {
      if (error instanceof SkillError) throw error;
      // Octokit can wrap transport failures. Recover only application-created error codes.
      const cause = (error as { cause?: unknown } | null)?.cause;
      if (cause instanceof SkillError) throw cause;
      const status = statusOf(error);
      if (status === 404) throw new SkillError('REPO_NOT_PUBLIC', 404);
      if (status === 403 || status === 429) throw new SkillError('GITHUB_RATE_LIMIT', 429, 60);
      throw new SkillError('GITHUB_UNAVAILABLE', 502);
    }
  };
}

function statusOf(error: unknown) { return (error as { status?: number } | null)?.status; }

function readFile(value: unknown, kind: ImportedSkill['source']['kind']) {
  const file = value as { type?: string; encoding?: string; content?: string; size?: number; path?: string; sha?: string } | null;
  if (!file || file.type !== 'file' || !Number.isSafeInteger(file.size) || file.size! < 0) throw new SkillError('INVALID_SKILL_METADATA', 422);
  if (file.size! > MAX_METADATA_BYTES) throw new SkillError('METADATA_TOO_LARGE', 422);
  const path = file.path ?? '';
  const sha = file.sha ?? '';
  if (typeof path !== 'string' || typeof sha !== 'string' || !/^[a-f0-9]{40}$/u.test(sha) || (kind === 'skill.json' ? path !== 'skill.json' : (path.length > 256 || !/^(?:[a-z0-9_.-]+\/)*README(?:\.md)?$/i.test(path)))) {
    throw new SkillError('INVALID_SKILL_METADATA', 422);
  }
  if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new SkillError('INVALID_SKILL_METADATA', 422);
  const encoded = file.content.replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length > Math.ceil(MAX_METADATA_BYTES / 3) * 4) throw new SkillError('INVALID_SKILL_METADATA', 422);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== file.size) throw new SkillError('INVALID_SKILL_METADATA', 422);
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha, path }; }
  catch { throw new SkillError('INVALID_SKILL_METADATA', 422); }
}
