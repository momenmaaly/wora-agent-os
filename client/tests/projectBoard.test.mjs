/**
 * Project OS board — demo separation + clear-demo contract.
 * The store ships demo seeds; they must be labeled (isDemo) and clearable
 * to a genuinely empty state so demo content is never presented as real work.
 */
import { equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

test('store seeds demo data but marks it as demo', () => {
  const src = read('store/useProjectStore.ts');
  ok(src.includes('isDemo: true'), 'initial state marks demo data as demo');
  ok(src.includes('DEMO_PROJECTS'), 'demo seeds still exist for first-run experience');
  ok(/clearDemoData:\s*\(\)=>\s*set\(\{\s*projects:\s*\[\],\s*activeProjectId:\s*null,\s*products:\s*\[\],\s*ideas:\s*\[\],\s*tasks:\s*\[\],\s*isDemo:\s*false/.test(src), 'clearDemoData empties every collection and clears the demo flag');
});

test('board UI renders the demo badge + clear action when isDemo', () => {
  const src = read('components/ProjectOSBoard.tsx');
  ok(src.includes('بيانات تجريبية · Demo'), 'demo badge is rendered');
  ok(src.includes('resetBoardToEmpty'), 'one-click demo clear is wired');
  ok(src.includes('board-sync-row'), 'sync status row exists');
});

test('boardSync pulls server state on boot and debounces pushes', () => {
  const src = read('store/boardSync.ts');
  ok(src.includes('osApi.board()'), 'pull on boot uses the durable board endpoint');
  ok(src.includes('osApi.saveBoard'), 'pushes persist to the server');
  ok(src.includes('800'), 'debounced push interval is 800ms');
  ok(src.includes("serverBacked"), 'sync status is surfaced for the UI');
});
