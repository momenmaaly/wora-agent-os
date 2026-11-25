import { deepEqual, equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ar, en } from '../src/i18n/dictionaries.ts';
import { buildMissionEvents } from '../src/os/missionEvents.ts';
import { missionStatusLabel, missionTone, outcomeStatusLabel, taskStatusLabel, taskTone, verificationStatusLabel } from '../src/os/labels.ts';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
const arabic = /[\u0600-\u06FF]/;

const t = (path) => path.split('.').reduce((node, key) => node?.[key], ar) ?? path;

const detail = {
  id: 'm1', objective: 'Build and verify a web application', status: 'awaiting_approval',
  summary: 'Task 4 is blocked pending a human decision.', requestedBy: 'preview', artifactId: 'a1',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z',
  tasks: [{
    id: 't1', orderIndex: 0, title: 'Define acceptance criteria', objective: 'Define the contract',
    specialization: 'product_manager', status: 'completed', agentId: 'a1',
    agent: { id: 'a1', name: 'Product Manager', specialization: 'product_manager' },
    dependsOn: [], acceptance: ['scope'], tool: 'text.extract_summary', toolInput: {}, detail: '',
    runs: [{ id: 'r1', status: 'completed', attempt: 1, startedAt: '2026-01-01T00:01:00.000Z', finishedAt: '2026-01-01T00:02:00.000Z', summary: 'Summary written', evidence: [{ id: 'e1' }], issues: [] }],
    createdAt: '2026-01-01T00:00:30.000Z', updatedAt: '2026-01-01T00:02:00.000Z',
  }],
  handoffs: [{ id: 'h1', taskId: 't1', from: 'product_manager', to: 'frontend_engineer', contract: {}, createdAt: '2026-01-01T00:02:30.000Z' }],
  approvals: [{
    id: 'ap1', kind: 'tool', missionId: 'm1', taskId: 't1', toolId: 'host.exec', actionSummary: 'Run tests',
    risk: 'high', toolInput: {}, requestedBy: 'preview', status: 'pending', decisionNote: '', decidedBy: null,
    decidedAt: null, createdAt: '2026-01-01T00:03:00.000Z',
  }],
  artifacts: [{ id: 'a1', name: 'build.md', kind: 'markdown', createdAt: '2026-01-01T00:04:00.000Z' }],
  verifications: [{
    id: 'v1', missionId: 'm1', taskId: 't1', runId: 'r1', result: 'passed', independence: 'independent',
    verifier: 'wora.verifier', failureReason: '', checks: [], createdAt: '2026-01-01T00:04:30.000Z',
  }],
  outcomeVerification: {
    missionId: 'm1', workspaceId: 'wora-preview', status: 'requires_human_review',
    checks: [], reasons: ['One task is blocked'], taskEvidence: [], artifactId: 'a1',
    generatedAt: '2026-01-01T00:05:00.000Z',
  },
};

const pagesSource = read('pages.ts');
const NAV_IDS = ['home', 'execution', 'agents', 'workflows', 'projects', 'terminal', 'artifacts', 'integrations', 'extensions', 'knowledge', 'approvals', 'activity', 'history'];
const SETTINGS_IDS = ['settings', 'security', 'models', 'system', 'pricing'];

function itemIds(source, groupId) {
  const block = source.split(`id: '${groupId}'`)[1] ?? '';
  const body = block.split('items: [')[1]?.split(']')[0] ?? '';
  return [...body.matchAll(/id: '([a-z]+)'/g)].map((match) => match[1]);
}

test('technical navigation groups and routes are wired to real pages', () => {
  deepEqual(itemIds(pagesSource, 'workspace'), ['home', 'execution', 'agents', 'workflows']);
  deepEqual(itemIds(pagesSource, 'build'), ['projects', 'terminal', 'artifacts']);
  deepEqual(itemIds(pagesSource, 'systems'), ['integrations', 'extensions', 'knowledge']);
  deepEqual(itemIds(pagesSource, 'governance'), ['approvals', 'activity', 'history']);
  deepEqual([...SETTINGS_IDS], ['settings', 'security', 'models', 'system', 'pricing']);
  ok(pagesSource.includes('export function workspaceRoute'), 'the app resolves pages through a single hash router');
  for (const id of [...NAV_IDS, ...SETTINGS_IDS]) ok(pagesSource.includes(`{ id: '${id}', icon:`), `page ${id} is registered`);
});

test('every technical nav label exists in both dictionaries', () => {
  for (const id of [...NAV_IDS, ...SETTINGS_IDS]) {
    ok(typeof ar.nav[id] === 'string' && ar.nav[id].length > 0, `nav.${id} missing in Arabic`);
    ok(typeof en.nav[id] === 'string' && en.nav[id].length > 0, `nav.${id} missing in English`);
  }
  for (const group of ['groupWorkspace', 'groupBuild', 'groupSystems', 'groupGovernance', 'groupSettings']) {
    ok(typeof ar.nav[group] === 'string', `nav.${group} missing in Arabic`);
    ok(typeof en.nav[group] === 'string', `nav.${group} missing in English`);
  }
});

test('mission event stream is derived from persisted tasks, runs, approvals and verification', () => {
  const events = buildMissionEvents(detail, t);
  equal(events.length, 6);
  deepEqual(events.map((event) => event.source), ['task', 'run', 'handoff', 'approval', 'verification', 'outcome']);
  equal(events[0].severity, 'info');
  equal(events[1].severity, 'success');
  equal(events[3].severity, 'warning');
  equal(events[4].severity, 'success');
  equal(events[5].severity, 'warning');
  ok(events.every((event) => event.at >= '2026-01-01T00:00:00.000Z'), 'events carry real timestamps');
  ok(events.some((event) => event.title.includes('Define acceptance criteria')), 'task title is carried into the log');
  ok(events.some((event) => event.detail?.includes('host.exec')), 'approval tool is carried into the log');
  deepEqual(events.map((event) => event.at), [...events.map((event) => event.at)].sort(), 'events are chronological');
});

test('status labels and tones map real lifecycle values', () => {
  equal(missionStatusLabel(t, 'awaiting_approval'), ar.execution.statusAwaitingApproval);
  equal(taskStatusLabel(t, 'blocked'), ar.execution.taskBlocked);
  equal(outcomeStatusLabel(t, 'requires_human_review'), ar.execution.outcomeRequiresReview);
  equal(verificationStatusLabel(t, 'passed'), ar.execution.verificationPassed);
  equal(missionTone('awaiting_approval'), 'warning');
  equal(missionTone('completed'), 'success');
  equal(taskTone('blocked'), 'warning');
  equal(taskTone('running'), 'brand');
});

test('technical surfaces use dictionary keys and expose no hardcoded Arabic copy', () => {
  const files = [
    'components/TechnicalWorkspace.tsx', 'components/ExecutionInspector.tsx', 'components/MissionLogPanel.tsx',
    'components/MissionSelect.tsx', 'components/WorkflowsPage.tsx', 'components/TerminalPage.tsx',
    'components/ArtifactsPage.tsx', 'components/KnowledgePage.tsx', 'components/ApprovalsPage.tsx',
    'components/ActivityPage.tsx', 'components/HistoryPage.tsx', 'components/SecurityPage.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    ok(source.includes('useI18n'), `${file} must consume the i18n hook`);
    ok(!arabic.test(source), `${file} must not contain hardcoded Arabic copy`);
  }
  const log = read('components/MissionLogPanel.tsx');
  ok(log.includes('disabled={visible.length === 0}'), 'copy action is disabled when the log is empty');
  ok(log.includes("role=\"log\""), 'the event stream is announced as a log');
});

test('execution log keeps a dark terminal surface in both themes', () => {
  const css = read('styles/technical-workspace.css');
  const block = css.match(/\.tech-log-body \{([\s\S]*?)\}/)?.[1] ?? '';
  ok(block.includes('background: var(--terminal-bg)'), 'log uses the dedicated terminal background token');
  ok(block.includes('border: 1px solid var(--terminal-border)'), 'log uses the dedicated terminal border token');
  ok(!block.includes('var(--ink)'), 'log contrast must not invert with the active theme');
});
