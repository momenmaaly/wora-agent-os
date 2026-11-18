import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createGitHubImporter } from './github.js';
import { extractSkill, MAX_METADATA_BYTES, parseRepository, SkillError } from './metadata.js';

const repo = parseRepository('https://github.com/Workshop/Text-Summary.git/');
const sha = 'a'.repeat(40);
const schema = { type: 'object', properties: { 'text.value': { type: 'string', minLength: 1 }, lang: { enum: ['ar', 'en'] } }, required: ['text.value'], additionalProperties: false };
const descriptor = { name: 'ملخّص نص', description: 'Summarize a plain text note.', inputSchema: schema };
const source = { kind: 'skill.json' as const, repository: repo.fullName, url: repo.url, path: 'skill.json', sha };

function response(data: unknown, status = 200) { return Response.json(data, { status }); }
function blob(value: string, path = 'skill.json') { return { type: 'file', size: Buffer.byteLength(value), encoding: 'base64', content: Buffer.from(value).toString('base64'), path, sha }; }
function importer(replies: Response[]) {
  const paths: string[] = [];
  const get = createGitHubImporter({ async fetch(input, init) {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    paths.push(url.pathname);
    const next = replies.shift();
    assert.ok(next, 'unexpected GitHub request');
    return next;
  } });
  return { call: () => get(repo, new AbortController().signal), paths };
}
function failure(code: string, status?: number) {
  return (error: unknown) => error instanceof SkillError && error.code === code && (status === undefined || error.status === status);
}
const publicRepository = () => response({ private: false, visibility: 'public' });

test('only the exact HTTPS GitHub repository origin and canonical paths are allowed', () => {
  assert.deepEqual(repo, { owner: 'workshop', repo: 'text-summary', fullName: 'workshop/text-summary', url: 'https://github.com/workshop/text-summary' });
  for (const input of [
    'http://github.com/a/b', 'https://github.com:443/a/b', 'https://github.com./a/b', 'https://github.com.other.invalid/a/b',
    'https://github.com@other.invalid/a/b', 'https://name@github.com/a/b', 'https://github.com/a/b?ref=branch', 'https://github.com/a/b#readme',
    'https://github.com/a/b/blob/main/skill.json', 'https://github.com/a/b%2fmain', 'https://github.com/a/..', 'https://github.com/K/k',
    'https://github.com\\a\\b', 'https://github.com/a/b\n/c',
  ]) assert.throws(() => parseRepository(input), failure('INVALID_REPOSITORY', 400), input);
});

test('Octokit reads only the public repository and its root skill descriptor', async () => {
  const mock = importer([publicRepository(), response(blob(JSON.stringify(descriptor)))]);
  assert.deepEqual(await mock.call(), { ...descriptor, source });
  assert.deepEqual(mock.paths, ['/repos/workshop/text-summary', '/repos/workshop/text-summary/contents/skill.json']);
});

test('README fallback extracts plain text and a fenced JSON Schema without rendering markup', async () => {
  const readme = `<!-- Metadata only -->\n# Note **Summary**\n\n![release](https://example.invalid)\n\nA [plain text](https://example.invalid) tool to summarize a note.\n\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\`\n`;
  const mock = importer([publicRepository(), response({}, 404), response(blob(readme, '.github/README.md'))]);
  const result = await mock.call();
  assert.equal(result.name, 'Note Summary'); assert.equal(result.description, 'A plain text tool to summarize a note.');
  assert.deepEqual(result.inputSchema, schema);
  assert.equal(result.source.kind, 'readme'); assert.equal(mock.paths.at(-1), '/repos/workshop/text-summary/readme');
  const noSchema = extractSkill('# Notes\n\nA project for taking notes.', { ...source, kind: 'readme' }, repo);
  assert.equal(noSchema.inputSchema, null);
  const declared = extractSkill(`### Notes\n~~~json\n${JSON.stringify({ ...descriptor, inputSchema: undefined, input_schema: schema })}\n~~~`, { ...source, kind: 'readme' }, repo);
  assert.equal(declared.name, descriptor.name); assert.deepEqual(declared.inputSchema, schema);
});

test('rejects absent, ill-shaped, external-reference and unbounded descriptors', () => {
  for (const inputSchema of [undefined, [], { type: 'string' }, { type: 'object', required: ['id', 1] }, { type: 'object', properties: { name: null } },
    { ...schema, properties: JSON.parse('{"__proto__":{"type":"string"}}') },
    { ...schema, $ref: 'https://other.invalid/schema.json' }, { ...schema, description: 'A'.repeat(1100) }]) {
    assert.throws(() => extractSkill(JSON.stringify({ ...descriptor, inputSchema }), source, repo), failure('INVALID_SKILL_METADATA', 422));
  }
  const deeplyNested = `{"name":"Note","description":"Plain note","inputSchema":{"type":"object","example":${'['.repeat(12_000)}null${']'.repeat(12_000)}}}`;
  assert.throws(() => extractSkill(deeplyNested, source, repo), failure('INVALID_SKILL_METADATA'));
  assert.throws(() => extractSkill('a'.repeat(MAX_METADATA_BYTES + 1), source, repo), failure('METADATA_TOO_LARGE'));
});

test('private repositories, redirects, oversized network responses and rate errors fail closed', async () => {
  for (const info of [{ private: true, visibility: 'private' }, { private: false, visibility: 'internal' }, {}]) {
    const mock = importer([response(info)]);
    await assert.rejects(mock.call(), failure('REPO_NOT_PUBLIC', 404)); assert.equal(mock.paths.length, 1);
  }
  for (const item of [new Response(null, { status: 302, headers: { Location: 'https://github.com/owner/renamed' } }), response({}, 404)]) {
    const mock = importer([item]);
    await assert.rejects(mock.call(), failure('REPO_NOT_PUBLIC', 404)); assert.equal(mock.paths.length, 1);
  }
  await assert.rejects(importer([response({}, 403)]).call(), failure('GITHUB_RATE_LIMIT', 429));
  const large = new Response('a'.repeat(145 * 1024));
  await assert.rejects(importer([publicRepository(), large]).call(), failure('METADATA_TOO_LARGE', 422));
  await assert.rejects(importer([publicRepository(), response({ ...blob('{}'), size: MAX_METADATA_BYTES + 1 })]).call(), failure('METADATA_TOO_LARGE', 422));
  await assert.rejects(importer([publicRepository(), response({}, 404), response({}, 404)]).call(), failure('NO_SKILL_METADATA', 422));
  await assert.rejects(importer([publicRepository(), response(blob('invalid'))]).call(), failure('INVALID_SKILL_METADATA', 422));
});
