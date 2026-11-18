import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { asksForReport, bestSkillMatch, briefTitle, officeReport, officeTasks, rankCandidates, taskExecutionNote } from '../src/office/work.ts';

const NOW = Date.UTC(2026, 10, 17, 23, 20);
const STAMP = new Date(NOW).toISOString();
const agent = (id, role, zone, extras = {}) => ({
  id, zoneId: `zone-${zone}`, displayName: id, status: 'ONLINE', lifecycleState: 'IDLE', activeTasks: 0,
  profile: { customRole: role, skills: [], specialty: '' }, ...extras,
});
const atlas = agent('atlas', 'Full-Stack Engineer', 'engineering');
const aria = agent('aria', 'Strategic Planner', 'planning');
const sentinel = agent('sentinel', 'Test Engineer', 'review');
const nova = agent('nova', 'Analyst', 'analytics');
const room = (entries) => ({ engineering: { entries } });
const task = (id, status, extras = {}) => ({ id, status, type: 'task', title: id, updatedAt: STAMP, targetAgentId: atlas.id, payload: {}, ...extras });
const locked = (zoneId) => zoneId === 'zone-analytics';

test('Arabic and English report questions do not cause an assignment, while generating a report is a task', () => {
  for (const text of ['مُلخّص الساحة', 'إيه اللي حصل النهارده؟', 'ورّيني حالة الفريق لو سمحت', 'Show me open tasks', 'What happened today?']) ok(asksForReport(text), text);
  for (const text of ['اكتب تقرير اليوم عن المبيعات', 'اعمل ملخص للعميل', 'Draft a workspace summary for customers']) equal(asksForReport(text), false, text);
});

test('the recommendation is grounded in role keywords or exact profile skills, not a mentioned name', () => {
  const agents = [aria, atlas, sentinel, nova];
  const matchAgent = (brief) => bestSkillMatch(rankCandidates(brief, agents, [], locked));
  equal(matchAgent('اختبِر التسجيل من الموبايل وابعث النتيجة إلى @Aria').agent.id, sentinel.id);
  equal(matchAgent('Implement a React component for sign-up').agent.id, atlas.id);
  equal(matchAgent('رتب أولويات الأسبوع').agent.id, aria.id);
  const analytical = matchAgent('حلّل البيانات وسجل أبرز المؤشرات');
  equal(analytical.agent.id, nova.id);
  equal(analytical.locked, true, 'a gated match is shown as gated, not enabled');
  const special = agent('writer', 'Writer', 'lounge', { profile: { customRole: 'Writer', skills: ['Technical Writing'] } });
  equal(bestSkillMatch(rankCandidates('Prepare technical writing for onboarding', [aria, special], [], locked)).agent.id, special.id);
  equal(matchAgent('Please contact JavaScriptDevelopers'), undefined, 'words do not match substrings or trigger random delegation');
});

test('equally skilled idle agents with less work come first; unavailable agents are excluded', () => {
  const rested = agent('rested', atlas.profile.customRole, 'engineering');
  const busy = agent('busy', atlas.profile.customRole, 'engineering', { lifecycleState: 'RESPONDING' });
  const away = agent('away', atlas.profile.customRole, 'engineering', { status: 'AWAY' });
  const offline = agent('offline', atlas.profile.customRole, 'engineering', { status: 'OFFLINE' });
  const failed = agent('failed', atlas.profile.customRole, 'engineering', { lifecycleState: 'ERROR' });
  const results = rankCandidates('Fix the React bug', [away, busy, offline, atlas, failed, rested], [task('fixed', 'done'), task('open', 'open')], locked);
  deepEqual(results.map((candidate) => candidate.agent.id), ['rested', 'atlas', 'busy']);
  match(results[1].reason, /1 من المهام المفتوحة/u);
});

test('the report excludes fixtures, signals and expired records, and keeps real local provenance', () => {
  const entries = [
    task('init-fake', 'done'), task('uuid-sample', 'approved', { payload: { sample: true } }), task('not-task', 'open', { type: 'signal' }),
    task('expired', 'open', { expiresAt: STAMP }), task('expired-status', 'expired'), task('denied', 'rejected'), task('active', 'in_progress'),
    task('response', 'review_pending', { payload: { directorResponse: 'Text result' } }), task('local-ws-1', 'open'), task('verified', 'approved'),
  ];
  const log = [{ id: 'evt', text: 'عاد الفريق إلى المكاتب', scope: 'session', timestamp: STAMP }];
  const report = officeReport(room(entries), log, [atlas], NOW);
  equal(officeTasks(room(entries), NOW).length, 5);
  deepEqual([report.waiting, report.working, report.finished, report.local, report.busy], [1, 2, 1, 1, 0]);
  deepEqual(report.recentEvents, log);
});

test('task titles are bounded and sanitized for display without losing the full brief', () => {
  equal(briefTitle('  اختبر  التسجيل\nمن الموبايل  '), 'اختبر التسجيل من الموبايل');
  const long = `${'س'.repeat(146)}👋 تكملة`;
  equal(briefTitle(long), `${'س'.repeat(146)}…`);
  ok(briefTitle(long).length <= 148);
  match(taskExecutionNote(task('saved', 'open', { payload: { directorExecution: 'unavailable' } })), /غير متاح/u);
  match(taskExecutionNote(task('ready', 'review_pending', { payload: { directorResponse: 'Text result', directorExecution: 'pending' } })), /جاهز للمراجعة/u);
});
