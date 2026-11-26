import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ar, en, directionFor } from '../src/i18n/dictionaries.ts';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
const arabic = /[\u0600-\u06FF]/;

test('Arabic and English Execution Center translations are complete and distinct', () => {
  const arKeys = Object.keys(ar.execution).sort();
  const enKeys = Object.keys(en.execution).sort();
  deepEqual(arKeys, enKeys, 'execution dictionaries have the same keys');
  ok(arKeys.length > 100, 'execution surface has a substantial translation set');
  for (const key of arKeys) {
    ok(typeof ar.execution[key] === 'string' && ar.execution[key].length > 0, `Arabic execution.${key} is non-empty`);
    ok(typeof en.execution[key] === 'string' && en.execution[key].length > 0, `English execution.${key} is non-empty`);
  }
  equal(ar.execution.title, 'مركز التنفيذ');
  equal(en.execution.title, 'Execution Center');
  equal(ar.execution.approveExecute, 'وافق ونفّذ');
  equal(en.execution.approveExecute, 'Approve and execute');
  match(ar.execution.activityLog, /\(\{n\}\)/);
  match(en.execution.activityLog, /\(\{n\}\)/);
});

test('English Execution Center contains no untranslated Arabic UI copy', () => {
  for (const [key, value] of Object.entries(en.execution)) {
    ok(!arabic.test(value), `English execution.${key} is not Arabic: ${value}`);
  }
  ok(Object.values(ar.execution).some((value) => arabic.test(value)), 'Arabic execution is actually Arabic');
});

test('Execution Center consumes translation keys instead of hardcoded system labels', () => {
  const source = read('components/ExecutionCenter.tsx');
  ok(!arabic.test(source), 'no hardcoded Arabic system labels remain in ExecutionCenter');
  ok(!source.includes('const EXAMPLES'), 'example prompts are translated');
  match(source, /useI18n\(\)/);
  match(source, /t\('execution\.title'\)/);
  match(source, /t\('execution\.approveExecute'\)/);
  match(source, /t\('execution\.activityAria'\)/);
  const used = [...new Set([...source.matchAll(/execution\.([A-Za-z0-9]+)/g)].map((entry) => entry[1]))];
  const missing = used.filter((key) => !(key in ar.execution));
  deepEqual(missing, [], 'every used execution translation key exists');
});

test('document direction is Arabic RTL and English LTR', () => {
  equal(directionFor('ar'), 'rtl');
  equal(directionFor('en'), 'ltr');
  const context = read('i18n/I18nContext.tsx');
  match(context, /directionFor\(lang\)/);
  match(context, /root\.lang = lang/);
  match(context, /root\.dir = dir/);
});
