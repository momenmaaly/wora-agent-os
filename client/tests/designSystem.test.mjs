import { ok, match } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

test('the product-wide design system stays restrained and defines desktop/mobile Campus rules', () => {
  const styles = [
    'index.css', 'styles/shell.css', 'styles/company-frame.css', 'styles/workbench.css',
    'styles/features.css', 'styles/studio.css', 'styles/floorplan.css', 'styles/campus.css',
  ].map(read).join('\n');
  ok(!styles.includes('radial-gradient('), 'no decorative radial gradients');
  ok(!styles.includes('backdrop-filter:'), 'no unnecessary glass effects');
  ok(!styles.includes('linear-gradient(145deg'), 'no decorative card gradients');
  ok(!styles.includes('text-shadow:'), 'no glow text treatment');

  const tokens = read('index.css');
  // Product reset 2026-11: intentional, restrained radii (8px panels / 6px controls)
  match(tokens, /--panel-radius:\s*8px/);
  match(tokens, /--control-radius:\s*6px/);
  match(tokens, /--font-sans:\s*'Inter Variable'/);
  match(tokens, /\.page-heading h1[^}]*font-size:\s*clamp\(23px/);

  const campus = read('styles/workbench.css');
  match(campus, /\.page-campus\s*\{[^}]*height:\s*100%/);
  match(campus, /\.campus-stage\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  match(campus, /\.campus-drawer\s*\{[^}]*position:\s*absolute/);
  const mobile = campus.slice(campus.indexOf('@media (max-width: 760px)'));
  ok(mobile.length > 0, 'mobile breakpoint exists');
  match(mobile, /\.campus-stage\s*\{[^}]*min-height:\s*62dvh/);
  match(mobile, /\.campus-drawer\s*\{[^}]*inset:\s*auto 0 0 0/);
  match(mobile, /\.campus-handoff-fields\s*\{\s*grid-template-columns:\s*1fr/);
});
