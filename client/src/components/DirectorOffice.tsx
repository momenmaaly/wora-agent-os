import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BriefcaseBusiness, Check, ClipboardList, LockKeyhole, Send, TextQuote } from 'lucide-react';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { useSocket, type AssignmentResult } from '../hooks/useSocket.js';
import { ROOM_BY_ID } from '../office/layout.js';
import { ROOM_DISPLAY } from '../office/presentation.js';
import {
  asksForReport, bestSkillMatch, briefTitle, canTakeTask, isInProgress, isOpenTask, localTime, officeReport, officeTasks,
  rankCandidates, taskExecutionNote, taskSourceLabel, taskStage, TASK_BRIEF_LIMIT, type Candidate, type OfficeReport, type ServerMode,
} from '../office/work.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import type { AgentParticipant, SharedWorkspaceEntry } from '../types.js';
import { AgentAvatar, ConnectionBadge } from './OfficePeople.js';
import { IconButton } from './ui.js';

type Proposal = { id: number; brief: string; candidate: Candidate; source: 'model' | 'local' };
type SavedAssignment = Extract<AssignmentResult, { ok: true }>;
type Reply =
  | { kind: 'report'; report: OfficeReport; mode: ServerMode | null; connected: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'assigned'; assignment: SavedAssignment; name: string };
type Exchange = { id: number; prompt: string; reply: Reply };
type OpenTasks = (zoneId?: string, entryId?: string) => void;

const FILL_REPORT = 'ملخّص الساحة';
const MAX_EXCHANGES = 18;
const ORIGIN_TEXT = { local: 'محلية للجلسة', preview: 'معاينة', session: 'نشاط محلي', server: 'لوحة المهام' };
const SAVE_TEXT = { local: 'اتحفظت في الجلسة المحلية.', preview: 'اتحفظت في خادم المعاينة.', server: 'اتحفظت في لوحة القسم.' };

function Report({ report, mode, connected, onTasks }: Extract<Reply, { kind: 'report' }> & { onTasks: OpenTasks }) {
  return <div className="director-report">
    <div className="director-report-head"><strong>{FILL_REPORT}</strong><time dateTime={report.capturedAt}>{localTime(report.capturedAt)}</time></div>
    <p className="field-note">{mode === 'preview' ? 'من سجل المعاينة' : mode === 'server' ? 'من لوحة المهام' : 'من هذه الجلسة المحلية'}{!connected && mode ? ' · آخر بيانات متاحة' : ''}{mode && report.local ? ` · يشمل ${report.local} مهمة محلية` : ''}</p>
    <dl className="director-counters">
      <div><dt>بانتظار العمل</dt><dd>{report.waiting}</dd></div>
      <div><dt>عمل أو مراجعة</dt><dd>{report.working}</dd></div>
      <div><dt>مكتملة</dt><dd>{report.finished}</dd></div>
    </dl>
    {!report.recentTasks.length && !report.recentEvents.length && <p className="field-note">لا توجد مهام أو أحداث مسجّلة بعد.</p>}
    {report.recentTasks.length > 0 && <div className="director-report-list"><h3>آخر تحديثات المهام</h3><ul>{report.recentTasks.map((task) => <li key={task.id}>
      <button type="button" onClick={() => onTasks(task.zoneId, task.id)}><bdi>{task.title}</bdi><small>{[taskStage(task), taskSourceLabel(task)].filter(Boolean).join(' · ')}</small></button>
    </li>)}</ul></div>}
    {report.recentEvents.length > 0 && <div className="director-report-list"><h3>نشاط هذه الجلسة</h3><ul>{report.recentEvents.map((event) => <li key={event.id}>
      <bdi>{event.text}</bdi><small>{ORIGIN_TEXT[event.scope]} · <time dateTime={event.timestamp}>{localTime(event.timestamp)}</time></small>
    </li>)}</ul></div>}
    {report.busy > 0 && <p className="field-note"><bdi>{report.busy}</bdi> من الوكلاء مشغولون الآن.</p>}
  </div>;
}

function TaskFeed({ tasks, agents, onTasks }: { tasks: SharedWorkspaceEntry[]; agents: Record<string, AgentParticipant>; onTasks: OpenTasks }) {
  return <aside className="panel director-tasks" aria-labelledby="director-task-title">
    <div className="workspace-panel-heading"><div><ClipboardList size={17} aria-hidden="true" /><h2 id="director-task-title">المهام الأخيرة</h2></div><bdi className="count-label">{tasks.filter(isOpenTask).length} مفتوحة</bdi></div>
    {tasks.length ? <ul>{tasks.slice(0, 5).map((task) => {
      const assignee = agents[task.targetAgentId ?? task.authorAgentId];
      return <li key={task.id}><button type="button" onClick={() => onTasks(task.zoneId, task.id)}>
        <span><bdi>{task.title}</bdi><small>{[assignee?.displayName, ROOM_DISPLAY[task.zoneId]?.label, taskSourceLabel(task)].filter(Boolean).join(' · ')}</small></span>
        <span className={`task-tag${isInProgress(task) ? ' is-working' : ''}`}>{taskStage(task)}</span>
      </button></li>;
    })}</ul> : <p className="workspace-empty">المهام اللي تسندها هتظهر هنا.</p>}
    <button type="button" className="text-link director-board-link" onClick={() => onTasks()}><ClipboardList size={15} aria-hidden="true" />لوحة المهام</button>
  </aside>;
}

export function DirectorOffice({ focusInput, onCampus, onUpgrade }: { focusInput: boolean; onCampus: () => void; onUpgrade: () => void }) {
  const workspaces = useWoraStore((state) => state.workspaces);
  const agents = useWoraStore((state) => state.agents);
  const plan = useBillingStore((state) => state.plan);
  const { sendWorkspaceSignal, recommendDirector } = useSocket();
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);
  const [pending, setPending] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState<'recommend' | 'assign' | null>(null);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const proposalCard = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const id = useRef(0);
  const tasks = useMemo(() => officeTasks(workspaces), [workspaces]);
  const showTasks: OpenTasks = (zoneId, entryId) => useWoraStore.getState().toggleWorkspaceHUD(true, zoneId, entryId);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (focusInput) input.current?.focus({ preventScroll: true }); }, [focusInput]);
  useEffect(() => { if (pending) proposalCard.current?.focus({ preventScroll: true }); }, [pending]);
  useEffect(() => { const log = scroll.current; if (log) log.scrollTop = log.scrollHeight; }, [history, busy, error]);

  function append(prompt: string, reply: Reply) {
    const key = ++id.current;
    setHistory((log) => [...log.slice(-(MAX_EXCHANGES - 1)), { id: key, prompt, reply }]);
  }

  function report(prompt = FILL_REPORT) {
    if (running.current || pending) return;
    const state = useWoraStore.getState();
    setError('');
    append(prompt, { kind: 'report', mode: state.serverMode, connected: state.connected, report: officeReport(state.workspaces, state.activityLog, Object.values(state.agents)) });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || pending || running.current) return;
    if (asksForReport(prompt)) { setDraft(''); report(prompt); return; }
    if (prompt.length < 5) { setError('اكتب وصفًا مختصرًا للمهمة.'); return; }
    const state = useWoraStore.getState();
    const isLocked = (zoneId: string) => isRoomLockedForPlan(zoneId, useBillingStore.getState().plan);
    const ranked = rankCandidates(prompt, Object.values(state.agents).filter((agent) => agent.zoneId && Object.hasOwn(ROOM_BY_ID, agent.zoneId)),
      officeTasks(state.workspaces), isLocked);
    if (!ranked.length) { setError('لا يوجد وكيل متاح للإسناد الآن.'); return; }

    running.current = true;
    setBusy('recommend'); setError('');
    try {
      const fallback = bestSkillMatch(ranked);
      const allowed = ranked.filter((candidate) => !candidate.locked && !candidate.agent.id.startsWith('agent-custom-') && state.zones.some((zone) => zone.id === candidate.zoneId)).slice(0, 16);
      const suggestion = fallback?.agent.id.startsWith('agent-custom-') ? null : await recommendDirector(prompt, allowed.map((candidate) => ({ agentId: candidate.agent.id, workload: Math.min(200, candidate.workload) })));
      if (!mounted.current) return;
      const fresh = useWoraStore.getState();
      const suggested = suggestion && allowed.find(({ agent, zoneId }) => agent.id === suggestion.agentId && !isLocked(zoneId)
        && fresh.agents[agent.id]?.zoneId === zoneId && canTakeTask(fresh.agents[agent.id]!));
      const useModel = suggestion && suggested;
      const candidate = useModel ? { ...suggested, reason: `النموذج طابق المهمة مع «${suggestion.skill}». ${suggested.availability}.` } : fallback;
      if (!candidate) {
        setDraft('');
        append(prompt, { kind: 'text', text: 'لسه مش واضح مين الأنسب. اكتب المطلوب تسليمه أو المهارة اللي محتاجها عشان أرشّح لك حد.' });
        requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
        return;
      }
      const proposal: Proposal = { id: id.current + 1, brief: prompt, candidate, source: useModel ? 'model' : 'local' };
      setDraft(''); setPending(proposal); append(prompt, { kind: 'proposal', proposal });
    } finally { running.current = false; if (mounted.current) setBusy(null); }
  }

  async function assign(proposal: Proposal) {
    if (running.current || uncertain) return;
    const { agent, zoneId } = proposal.candidate;
    running.current = true; setBusy('assign'); setError('');
    let result: AssignmentResult;
    try { result = await sendWorkspaceSignal(zoneId, agent.id, briefTitle(proposal.brief), { source: 'director', brief: proposal.brief }); }
    catch { result = { ok: false, reason: 'unconfirmed' }; }
    finally { running.current = false; if (mounted.current) setBusy(null); }
    if (!mounted.current) return;
    if (!result.ok) {
      const unknown = result.reason === 'unconfirmed';
      setUncertain(unknown);
      setError(unknown ? 'لم يصل تأكيد الحفظ. راجع لوحة المهام قبل إعادة الإسناد.'
        : result.reason === 'invalid' ? 'الترشيح لم يعد متاحًا. عدّل المهمة واعرض ترشيحًا جديدًا.' : 'لم تُسند المهمة. تأكّد من الاتصال وجرّب مرة أخرى.');
      return;
    }
    setPending(null);
    const assignment = result;
    setHistory((log) => log.map((exchange) => exchange.id === proposal.id
      ? { ...exchange, reply: { kind: 'assigned', assignment, name: agent.displayName } } : exchange));
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }

  function edit(proposal: Proposal) {
    setHistory((log) => log.filter((exchange) => exchange.id !== proposal.id));
    setPending(null); setError(''); setUncertain(false); setDraft(proposal.brief);
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }

  return <div className="director-office">
    <header className="workbench-header">
      <div className="workbench-title"><h1>مكتب المدير</h1><ConnectionBadge /></div>
      <button type="button" className="button ghost" onClick={onCampus}><ArrowRight size={16} aria-hidden="true" />ساحة العمل</button>
    </header>
    <div className="director-grid">
      <section className="panel director-assistant" aria-labelledby="director-assistant-title">
        <div className="workspace-panel-heading director-assistant-head">
          <div><span className="director-icon"><BriefcaseBusiness size={19} aria-hidden="true" /></span><h2 id="director-assistant-title">مساعد المدير</h2></div>
          <button type="button" className="button small" disabled={Boolean(busy || pending)} onClick={() => report()}><TextQuote size={15} aria-hidden="true" />{FILL_REPORT}</button>
        </div>
        <div className="director-log hq-scroll" ref={scroll} role="log" aria-label="محادثة المدير" tabIndex={0}>
          {!history.length && <div className="director-empty"><strong>إيه اللي محتاجه من الفريق؟</strong><p>اكتب المهمة، أو اطلب «ملخّص الساحة».</p></div>}
          {history.map(({ id: key, prompt, reply }) => <div className="director-exchange" key={key}>
            <p dir="auto" className="director-prompt">{prompt}</p>
            <div className="director-reply">
              {reply.kind === 'report' && <Report {...reply} onTasks={showTasks} />}
              {reply.kind === 'text' && <p className="director-text">{reply.text}</p>}
              {reply.kind === 'proposal' && (() => {
                const { agent, zoneId, reason } = reply.proposal.candidate;
                const locked = isRoomLockedForPlan(zoneId, plan);
                const current = agents[agent.id];
                const available = current && current.zoneId === zoneId && canTakeTask(current);
                return <div className="director-proposal" tabIndex={-1} ref={proposalCard} role="group" aria-label="ترشيح المهمة">
                  <div className="director-candidate"><AgentAvatar agent={agent} /><span><bdi>{agent.displayName}</bdi><small>{agent.profile.customRole} · {ROOM_DISPLAY[zoneId]?.label}</small></span>
                    <small className="task-tag">{reply.proposal.source === 'model' ? 'ترشيح بالنموذج' : 'مطابقة المهارات'}</small></div>
                  <p>{reason}</p>
                  {locked && <p className="field-note"><LockKeyhole size={14} className="inline-icon" aria-hidden="true" />الإسناد للقسم ده متاح مع Pro.</p>}
                  {!locked && !available && <p className="field-note">الوكيل لم يعد متاحًا.</p>}
                  <div className="director-actions">
                    {locked ? <button type="button" className="button small" onClick={onUpgrade}>عرض الخطة</button> : <button type="button" className="button primary" disabled={Boolean(busy) || uncertain || !available} onClick={() => assign(reply.proposal)}>{busy === 'assign' ? 'جارٍ الحفظ…' : <>إسناد إلى <bdi>{agent.displayName}</bdi></>}</button>}
                    <button type="button" className="button small ghost" disabled={Boolean(busy)} onClick={() => edit(reply.proposal)}>تعديل المهمة</button>
                    {uncertain && <button type="button" className="text-link" onClick={() => showTasks(zoneId)}>راجع لوحة القسم</button>}
                  </div>
                </div>;
              })()}
              {reply.kind === 'assigned' && (() => {
                const { entryId, zoneId, scope } = reply.assignment;
                const entry = tasks.find((task) => task.id === entryId);
                const note = taskExecutionNote(entry);
                return <div className="director-receipt">
                  <strong><Check size={17} aria-hidden="true" />أُسندت المهمة إلى <bdi>{reply.name}</bdi></strong>
                  <p className="field-note">{SAVE_TEXT[scope]} {note}</p>
                  {entry && <button type="button" className="text-link" onClick={() => showTasks(zoneId, entryId)}><ClipboardList size={15} aria-hidden="true" />{entry.status === 'review_pending' ? 'عرض ردّ الوكيل' : 'فتح المهمة'}</button>}
                </div>;
              })()}
            </div>
          </div>)}
          {busy === 'recommend' && <p role="status" className="director-wait">جارٍ مطابقة المهمة مع الفريق…</p>}
          {error && <p role="alert" className="director-error">{error}</p>}
        </div>
        <form className="director-composer" onSubmit={submit}>
          <textarea ref={input} rows={2} className="field" dir="auto" maxLength={TASK_BRIEF_LIMIT} aria-label="اكتب طلبًا لمساعد المدير" placeholder={pending ? 'راجع الترشيح قبل إرسال طلب جديد' : 'مثال: اختبر التسجيل من الموبايل'} disabled={Boolean(pending || busy)} value={draft}
            onChange={(event) => { setDraft(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <IconButton type="submit" icon={Send} className="director-send" label="إرسال الطلب" disabled={!draft.trim() || Boolean(pending || busy)} />
        </form>
      </section>
      <TaskFeed tasks={tasks} agents={agents} onTasks={showTasks} />
    </div>
  </div>;
}
