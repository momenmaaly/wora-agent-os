import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import {
  categoriesOf, filterPackages, isAdmin, isMember, parseToolInput, planBlockers,
  pluginTemplate, scopeKey, skillTemplate, summarizeProfile,
} from '../src/extensions/model.ts';
import { ar, en } from '../src/i18n/dictionaries.ts';

const pkg = (overrides = {}) => ({
  id: 'pkg_1', kind: 'skill', key: 'wora.test', name: 'Test', latestVersion: '1.0.0',
  category: 'engineering', tags: ['test'], description: 'A test package', author: 'WORA',
  type: 'knowledge', capabilities: [], scope: ['instance'], permissions: [], requiresApproval: false,
  executionModel: 'instructions-only', secrets: [], compatibility: null, dependencies: [],
  requirements: null, tools: [], trust: 'official', status: 'available', checksum: 'sha256:x',
  autoLoad: false, marketplace: { id: 'mkt_1', name: 'Official', trust: 'official', url: 'bundled://x', pinned: true },
  versions: [], installations: [], installed: false, enabled: false, security: null, warnings: [],
  ...overrides,
});

test('package filters combine kind, text, category, marketplace, scope and install state', () => {
  const packages = [
    pkg({ id: 'a', name: 'Backend', key: 'wora.backend', category: 'engineering', installed: true, enabled: true, installations: [{ scope: 'agent', scopeId: 'agt_1' }] }),
    pkg({ id: 'b', name: 'Frontend', key: 'wora.frontend', category: 'engineering', marketplace: { id: 'mkt_2', name: 'Community', trust: 'community', url: 'https://x', pinned: false } }),
    pkg({ id: 'c', kind: 'plugin', name: 'Playwright', key: 'wora.playwright', category: 'tools' }),
  ];
  const base = { query: '', kind: 'skill', category: '', marketplace: '', scope: '', installed: false, enabled: false };
  deepEqual(filterPackages(packages, base).map((entry) => entry.id), ['a', 'b']);
  deepEqual(filterPackages(packages, { ...base, query: 'front' }).map((entry) => entry.id), ['b']);
  deepEqual(filterPackages(packages, { ...base, marketplace: 'mkt_2' }).map((entry) => entry.id), ['b']);
  deepEqual(filterPackages(packages, { ...base, installed: true }).map((entry) => entry.id), ['a']);
  deepEqual(filterPackages(packages, { ...base, enabled: true }).map((entry) => entry.id), ['a']);
  deepEqual(filterPackages(packages, { ...base, scope: 'agent' }).map((entry) => entry.id), ['a']);
  deepEqual(filterPackages(packages, { ...base, kind: 'plugin' }).map((entry) => entry.id), ['c']);
  deepEqual(categoriesOf(packages, 'skill'), ['engineering']);
});

test('profile summary and plan blockers are derived from real resolved data', () => {
  deepEqual(summarizeProfile(null), { skills: 0, plugins: 0, tools: 0, blocked: 0, autoLoaded: 0 });
  const summary = summarizeProfile({
    skills: [{ key: 'a', autoLoad: true }], plugins: [{ key: 'p', tools: ['t'], autoLoad: true }],
    tools: ['t', 'core'], blocked: [{ key: 'x' }], autoLoad: { skills: ['a@1'], plugins: ['p@1'] },
  });
  deepEqual(summary, { skills: 1, plugins: 1, tools: 2, blocked: 1, autoLoaded: 2 });

  const blockers = planBlockers({
    missing: [{ key: 'dep', constraint: '^1.0.0' }],
    conflicts: [{ key: 'root', detail: 'version conflict' }],
    cycles: [['a', 'b', 'a']],
    missingTools: [{ key: 'root', tool: 'github' }],
    missingSecrets: ['TOKEN'],
  });
  deepEqual(blockers, [
    'missing:dep@^1.0.0', 'conflict:root:version conflict', 'cycle:a>b>a', 'tool:github', 'secret:TOKEN',
  ]);
  deepEqual(planBlockers(null), []);
});

test('tool input parsing is strict: empty is an object, arrays and bad JSON are refused', () => {
  deepEqual(parseToolInput('   '), { ok: true, value: {} });
  deepEqual(parseToolInput('{"text":"hi"}'), { ok: true, value: { text: 'hi' } });
  deepEqual(parseToolInput('[1,2]'), { ok: false, error: 'not-an-object' });
  deepEqual(parseToolInput('{bad'), { ok: false, error: 'invalid-json' });
});

test('manifest templates are valid JSON with the required schema version', () => {
  for (const template of [skillTemplate(), pluginTemplate()]) {
    const parsed = JSON.parse(template);
    equal(parsed.schema_version, '1.0');
    ok(parsed.id);
    ok(parsed.version);
    ok(parsed.scope.length >= 1);
  }
  equal(JSON.parse(pluginTemplate()).type, 'http');
});

test('scope keys, roles and display helpers stay aligned with the UI contract', () => {
  equal(scopeKey('instance'), 'ext.scopeInstance');
  equal(scopeKey('agent'), 'ext.scopeAgent');
  equal(isAdmin('owner'), true);
  equal(isAdmin('member'), false);
  equal(isMember('member'), true);
  equal(isMember('viewer'), false);
});

test('every extension label exists in both dictionaries with the same shape', () => {
  deepEqual(Object.keys(ar.ext).sort(), Object.keys(en.ext).sort());
  for (const key of Object.keys(ar.ext)) ok(ar.ext[key].length > 0, `ar.ext.${key} is empty`);
  for (const key of Object.keys(en.ext)) ok(en.ext[key].length > 0, `en.ext.${key} is empty`);
  equal(ar.nav.extensions, 'القدرات');
  equal(en.nav.extensions, 'Capabilities');
});
