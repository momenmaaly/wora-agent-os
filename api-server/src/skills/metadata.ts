import { z } from 'zod';
import type { ImportedSkill } from '../../../shared/types/index.js';

export type SkillDraft = Omit<ImportedSkill, 'id' | 'active' | 'importedAt'>;
export type SkillErrorCode = 'INVALID_REPOSITORY' | 'REPO_NOT_PUBLIC' | 'NO_SKILL_METADATA' | 'INVALID_SKILL_METADATA' | 'METADATA_TOO_LARGE' | 'GITHUB_RATE_LIMIT' | 'GITHUB_UNAVAILABLE' | 'SKILLS_UNAVAILABLE' | 'SIGN_IN_REQUIRED' | 'AGENT_NOT_FOUND' | 'SKILL_NOT_FOUND' | 'SKILL_LIMIT' | 'SKILLS_BUSY' | 'RATE_LIMITED' | 'INVALID_REQUEST';

export class SkillError extends Error {
  constructor(readonly code: SkillErrorCode, readonly status: number, readonly retryAfter?: number) { super(code); }
}

export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_SKILLS = 12;

export type Repository = { owner: string; repo: string; fullName: string; url: string };
const REPO_PATH = /^https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9_.-]{1,100})\/?$/i;

/** Accept only canonical public-repository addresses. Network requests never use this URL. */
export function parseRepository(input: string): Repository {
  const match = REPO_PATH.exec(input.trim());
  const owner = match?.[1]?.toLowerCase();
  const repo = match?.[2]?.replace(/\.git$/iu, '').toLowerCase();
  if (!owner || !repo || repo === '.' || repo === '..') throw new SkillError('INVALID_REPOSITORY', 400);
  const fullName = `${owner}/${repo}`;
  return { owner, repo, fullName, url: `https://github.com/${fullName}` };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const forbiddenKey = /^(?:__proto__|constructor|prototype)$/u;
const references = new Set(['$ref', '$dynamicRef', '$recursiveRef']);
const fieldName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 120 && !forbiddenKey.test(value);
const text = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/gu, ' ').trim();
const descriptor = z.object({
  name: z.string().max(120), description: z.string().max(800),
  inputSchema: z.unknown().optional(), input_schema: z.unknown().optional(), parameters: z.unknown().optional(),
});

/** A bounded, inert JSON Schema document. It is stored and displayed, never compiled or dereferenced. */
function inputSchema(value: unknown) {
  if (!record(value) || value.type !== 'object') return null;
  if (value.properties !== undefined && !record(value.properties)) return null;
  if (value.required !== undefined && (!Array.isArray(value.required) || !value.required.every(fieldName) || new Set(value.required).size !== value.required.length)) return null;
  if (record(value.properties) && !Object.values(value.properties).every((item) => record(item) || typeof item === 'boolean')) return null;
  let count = 0;
  function safe(node: unknown, depth: number): boolean {
    if (++count > 256 || depth > 9) return false;
    if (Array.isArray(node)) return node.length <= 48 && node.every((item) => safe(item, depth + 1));
    if (record(node)) return Object.keys(node).length <= 48 && Object.entries(node).every(([key, item]) => fieldName(key)
      && (!references.has(key) || (typeof item === 'string' && item.startsWith('#'))) && safe(item, depth + 1));
    return node === null || typeof node === 'boolean' || (typeof node === 'string' && node.length <= 1_024) || (typeof node === 'number' && Number.isFinite(node));
  }
  return safe(value, 0) && Buffer.byteLength(JSON.stringify(value)) <= 5_120 ? value : null;
}

function decodeJson(source: string): unknown {
  try { return JSON.parse(source.replace(/^\uFEFF/u, '')); }
  catch { return null; }
}

function fromDescriptor(raw: unknown) {
  const parsed = descriptor.safeParse(raw);
  if (!parsed.success) return null;
  const name = text(parsed.data.name);
  const description = text(parsed.data.description);
  const schema = inputSchema(parsed.data.inputSchema ?? parsed.data.input_schema ?? parsed.data.parameters);
  return name && description && schema ? { name, description, inputSchema: schema } : null;
}

function markdownText(line: string) {
  return text(line.replace(/!\[[^\]]*\]\([^)]*\)/gu, '').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]*>/gu, '').replace(/[`*_~]/gu, ''));
}

function fromReadme(source: string, repo: string): Pick<SkillDraft, 'name' | 'description' | 'inputSchema'> | null {
  let schema: ImportedSkill['inputSchema'] = null;
  for (const block of source.matchAll(/^ {0,3}(`{3,}|~{3,})[ \t]*json[ \t]*\r?\n([\s\S]*?)^ {0,3}\1[ \t]*$/gimu)) {
    const raw = decodeJson(block[2] ?? '');
    const declared = fromDescriptor(raw);
    if (declared) return declared;
    schema ??= inputSchema(raw);
  }
  const lines = source.replace(/<!--[^]*?-->/gu, '').split(/\r?\n/u);
  let name = '';
  let fence = '';
  const paragraph: string[] = [];
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; continue; }
    if (fence) continue;
    const heading = /^\s*#\s+(.+)$/u.exec(line)?.[1];
    if (heading && !name) name = markdownText(heading);
    if (!line.trim() || /^\s*(?:[#>!<|]|[-+*] |\[[^\]]+\]:)/u.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    const plain = markdownText(line);
    if (plain && /\p{L}/u.test(plain)) paragraph.push(plain);
    if (paragraph.join(' ').length >= 680) break;
  }
  const description = paragraph.join(' ').slice(0, 680).trim();
  return description ? { name: (name || repo).slice(0, 120), description, inputSchema: schema } : null;
}

export function extractSkill(source: string, file: ImportedSkill['source'], repo: Repository): SkillDraft {
  if (Buffer.byteLength(source) > MAX_METADATA_BYTES) throw new SkillError('METADATA_TOO_LARGE', 422);
  const metadata = file.kind === 'skill.json' ? fromDescriptor(decodeJson(source)) : fromReadme(source, repo.repo);
  if (!metadata) throw new SkillError('INVALID_SKILL_METADATA', 422);
  return { ...metadata, source: file };
}
