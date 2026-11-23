/**
 * i18n contract — the Arabic-first localization layer.
 * Both dictionaries must expose identical key paths; every leaf non-empty;
 * every navigable page id must have a nav label in both languages.
 */
import { ok, deepEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ar, en } from '../src/i18n/dictionaries.ts';

const keyPaths = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keyPaths(value, `${prefix}${key}.`));

const leaves = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`));

test('Arabic and English dictionaries expose identical key paths', () => {
  deepEqual(keyPaths(en).sort(), keyPaths(ar).sort());
});

test('every translated leaf is a non-empty string in both languages', () => {
  for (const [path, value] of [...leaves(ar), ...leaves(en)]) {
    ok(typeof value === 'string' && value.trim().length > 0, `empty translation at ${path}`);
  }
});

test('every navigable page id has a nav label in Arabic and English', () => {
  const pages = readFileSync(fileURLToPath(new URL('../src/pages.ts', import.meta.url)), 'utf8');
  const ids = [...pages.matchAll(/\{ id: '([a-z]+)', icon:/g)].map((m) => m[1]);
  ok(ids.length >= 12, `expected nav/settings/legacy ids, got ${ids.length}`);
  for (const id of ids) {
    ok(typeof ar.nav[id] === 'string', `nav.${id} missing in Arabic`);
    ok(typeof en.nav[id] === 'string', `nav.${id} missing in English`);
  }
});

test('Arabic is the default and pre-paint script wires lang/dir before CSS', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  ok(html.includes('lang="ar" dir="rtl"'), 'html shell defaults to Arabic RTL');
  ok(html.includes("localStorage.getItem('wora:lang')"), 'language choice is read pre-paint');
  ok(html.includes("root.dir = lang === 'ar' ? 'rtl' : 'ltr'"), 'dir follows the persisted language');
});

test('shell entry points consume the i18n dictionary (no hardcoded brand copy)', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
  for (const file of ['App.tsx', 'components/CompanySidebar.tsx', 'components/CompanyHeader.tsx', 'components/ExecutiveCommandBar.tsx', 'components/CommandCenter.tsx', 'components/OrganizationsPage.tsx', 'components/WorkspacesPage.tsx']) {
    ok(read(file).includes('useI18n'), `${file} must use the i18n hook`);
  }
});
