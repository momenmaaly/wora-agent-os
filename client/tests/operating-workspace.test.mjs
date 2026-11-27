import { deepEqual, equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ar, en } from '../src/i18n/dictionaries.ts';
import { attentionItems, derivePhases, missionActivity, nextAction } from '../src/workspace/model.ts';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
const pagesSource = read('pages.ts');
const arabic = /[\u0600-\u06FF]/;

function shapeKeys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? [path, ...shapeKeys(child, path)] : [path];
  });
}

const detail = {
  id: 'm1', objective: 'Verify the workspace', status: 'awaiting_approval', summary: 'Waiting for a human decision.',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z',
  problemProfile: { domain: 'engineering', confidence: 0.8, missingInformation: ['acceptance criteria'], algorithmSelection: { primary: null } },
  reasoning: null, composition: null, planVersions: [],
  tasks: [{
    id: 't1', orderIndex: 0, title: 'Inspect runtime', objective: 'Inspect runtime', specialization: 'generalist',
    status: 'blocked', agentId: 'a1', agent: { id: 'a1', name: 'Generalist' }, dependsOn: [], acceptance: ['evidence'],
    tool: 'host.exec', toolInput: {}, detail: 'Approval required', runs: [],
    createdAt: '2026-01-01T00:00:10.000Z', updatedAt: '2026-01-01T00:02:00.000Z',
  }],
  handoffs: [], artifacts: [],
  approvals: [{
    id: 'ap1', kind: 'tool', missionId: 'm1', taskId: 't1', toolId: 'host.exec', actionSummary: 'Run tests',
    risk: 'high', toolInput: {}, requestedBy: 'preview', status: 'pending', decisionNote: '', decidedBy: null,
    decidedAt: null, createdAt: '2026-01-01T00:01:00.000Z',
  }],
  verifications: [], outcomeVerification: null,
};

test('operating workspace: five primary zones resolve and every op label exists in both languages', () => {
  ok(pagesSource.includes("?? 'brief'"), 'the default route is Brief');
  for (const page of ['brief', 'run', 'library', 'capabilities', 'system']) {
    ok(pagesSource.includes(`{ id: '${page}', icon:`), `page ${page} is registered`);
    ok(typeof ar.nav[page] === 'string' && ar.nav[page].length > 0, `nav.${page} missing in Arabic`);
    ok(typeof en.nav[page] === 'string' && en.nav[page].length > 0, `nav.${page} missing in English`);
    ok(typeof ar.op[page] === 'object' && typeof en.op[page] === 'object', `op.${page} missing`);
  }
  deepEqual(shapeKeys(ar.op).sort(), shapeKeys(en.op).sort());
});

test('operating workspace: phases, attention, activity and next action derive from real mission state', () => {
  const t = (path) => path;
  const phases = derivePhases(detail, t);
  equal(phases.length, 6);
  equal(phases[0].state, 'complete');
  ok(phases.some((phase) => phase.state === 'blocked'), 'a blocked approval or task must mark the current phase blocked');
  ok(phases.every((phase) => phase.label.startsWith('op.run.phase')));
  const attention = attentionItems(detail, t);
  equal(attention.length, 2);
  equal(attention[0].kind, 'approval');
  equal(attention[1].kind, 'blocked');
  ok(nextAction(detail, t).includes('nextApproval'));
  const activity = missionActivity(detail, t);
  ok(activity.some((event) => event.id === 'task-t1'));
  ok(activity.some((event) => event.id === 'approval-ap1'));
});

test('operating workspace: components consume i18n and carry no hardcoded Arabic copy', () => {
  for (const file of ['workspace/BriefZone.tsx', 'workspace/RunZone.tsx', 'workspace/LibraryZone.tsx', 'workspace/SystemZone.tsx', 'workspace/ApproachPreview.tsx', 'workspace/ClarificationPanel.tsx', 'components/ExperienceModeControl.tsx']) {
    const source = read(file);
    ok(source.includes('useI18n'), `${file} must consume the i18n hook`);
    ok(!arabic.test(source), `${file} must not contain hardcoded Arabic copy`);
  }
  const extensions = read('components/ExtensionsHub.tsx');
  ok(extensions.includes("variant === 'capabilities'"), 'capability route must use the capability variant');
  ok(extensions.includes("tab === 'agents'"), 'agents must be exposed inside capabilities');
});
