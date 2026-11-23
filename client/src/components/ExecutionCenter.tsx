import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Bot, CheckCircle2, ChevronDown, ChevronLeft, Circle, CircleAlert,
  Download, FileText, FlaskConical, LoaderCircle, Play, RefreshCw, Rocket, ScrollText, ShieldCheck, Wrench, XCircle,
} from 'lucide-react';
import { OsApiError, osApi, type MissionDetail, type MissionSummary, type OsTask } from '../os/api.js';

const STATUS_LABEL: Record<MissionSummary['status'], string> = {
  planning: 'يخطط', running: 'قيد التنفيذ', completed: 'مكتملة', failed: 'متعثرة',
};
const TASK_STATUS_LABEL: Record<OsTask['status'], string> = {
  created: 'منشأة', planned: 'مخططة', assigned: 'مُسندة', running: 'قيد التنفيذ', reviewing: 'قيد المراجعة', completed: 'مكتملة', failed: 'فشلت', blocked: 'محظورة',
};
const TASK_ICON: Record<OsTask['status'], typeof CheckCircle2> = {
  created: Circle, planned: Circle, assigned: Circle, running: LoaderCircle, reviewing: LoaderCircle,
  completed: CheckCircle2, failed: XCircle, blocked: CircleAlert,
};

const EXAMPLES = [
  'Inspect my computer and identify potential problems',
  'Create a software testing agent',
  'Build a working web application',
  'Optimize the allocation of 20 employees across 5 shifts respecting availability and minimizing labor cost',
  'Build an organization to develop and operate an online marketplace',
];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'الآن';
  if (diff < 3_600_000) return `منذ ${Math.max(1, Math.floor(diff / 60_000))} د`;
  if (diff < 86_400_000) return `منذ ${Math.floor(diff / 3_600_000)} س`;
  return `منذ ${Math.floor(diff / 86_400_000)} ي`;
}

function StatusPill({ status }: { status: MissionSummary['status'] }) {
  return <span className={`os-pill os-pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function TaskRow({ task }: { task: OsTask }) {
  const [open, setOpen] = useState(false);
  const Icon = TASK_ICON[task.status];
  return (
    <div className={`os-task os-task-${task.status}`}>
      <button type="button" className="os-task-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon size={17} className={task.status === 'running' ? 'os-spin' : undefined} aria-hidden="true" />
        <span className="os-task-title">{task.title}
          <small>{task.specialization.replace(/_/g, ' ')}{task.agent ? ` · ${task.agent.name}` : ''}{task.tool ? ` · ${task.tool}` : ''}</small>
        </span>
        <span className={`os-pill os-pill-task-${task.status}`}>{TASK_STATUS_LABEL[task.status]}</span>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
      </button>
      {open && <div className="os-task-body">
        <p className="os-task-detail">{task.detail}</p>
        <div className="os-columns">
          <div>
            <h4>معايير القبول</h4>
            <ul className="os-acceptance">{task.acceptance.map((a) => <li key={a}><ShieldCheck size={13} aria-hidden="true" />{a}</li>)}</ul>
          </div>
          <div>
            <h4>المنفذ (Tool Input)</h4>
            <pre className="os-pre">{JSON.stringify(task.toolInput, null, 2).slice(0, 2500)}</pre>
          </div>
        </div>
        {task.runs.map((run) => (
          <div key={run.id} className="os-run">
            <div className="os-run-head">
              <strong>محاولة {run.attempt}</strong>
              <span>{run.summary}</span>
              <small className="subtle">{run.finishedAt ? relTime(run.finishedAt) : ''}</small>
            </div>
            {run.issues.length > 0 && <ul className="os-issues">{run.issues.map((i) => <li key={i}><CircleAlert size={12} aria-hidden="true" />{i}</li>)}</ul>}
            {run.evidence.map((ev, index) => (
              <details key={index} className="os-evidence">
                <summary><FileText size={12} aria-hidden="true" /> الدليل {index + 1} — {String(ev['tool'] ?? '')} {ev['ok'] === false ? '(فشل)' : '(نجاح)'}</summary>
                <pre className="os-pre">{JSON.stringify(ev, null, 2).slice(0, 6000)}</pre>
              </details>
            ))}
          </div>
        ))}
      </div>}
    </div>
  );
}

export function ExecutionCenter() {
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshMissions = useCallback(async () => {
    try {
      const list = await osApi.missions();
      setMissions(list);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر الاتصال بخدمة التنفيذ.');
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    try { setDetail(await osApi.mission(id)); } catch { /* transient poll failure */ }
  }, []);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('wora:os:launchError');
      if (pending) { setError(pending); sessionStorage.removeItem('wora:os:launchError'); }
    } catch { /* ignore */ }
    void refreshMissions();
  }, [refreshMissions]);
  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
    else setDetail(null);
  }, [selectedId, refreshDetail]);

  const anyRunning = (missions ?? []).some((m) => m.status === 'planning' || m.status === 'running') || detail?.status === 'running' || detail?.status === 'planning';
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => {
      void refreshMissions();
      if (selectedId) void refreshDetail(selectedId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [anyRunning, refreshMissions, refreshDetail, selectedId]);

  async function launch(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await osApi.launchMission(trimmed);
      setObjective('');
      setSelectedId(created.id);
      setDetail(created);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر إطلاق المهمة.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadArtifact(artifactId: string) {
    try {
      const artifact = await osApi.artifact(artifactId);
      const blob = new Blob([artifact.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تنزيل المخرج.');
    }
  }

  const selected = missions?.find((m) => m.id === selectedId) ?? null;
  const taskProgress = useMemo(() => {
    if (!detail) return null;
    const done = detail.tasks.filter((t) => t.status === 'completed').length;
    return { done, total: detail.tasks.length };
  }, [detail]);

  return (
    <div className="os-page">
      <header className="os-page-head">
        <div>
          <h1><Rocket size={20} aria-hidden="true" /> مركز التنفيذ</h1>
          <p className="subtle">اكتب الهدف كما تفكر فيه. WORA يحلل، يخطط، يوجه للوكيل المناسب، ينفذ، يراجع بلا ادعاء، ويسلم بتسليم فعلي.</p>
        </div>
        <button type="button" className="button ghost small" onClick={() => void refreshMissions()} aria-label="تحديث">
          <RefreshCw size={15} aria-hidden="true" /> تحديث
        </button>
      </header>

      {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

      <form className="os-launch" onSubmit={(event) => { event.preventDefault(); void launch(objective); }}>
        <span className="os-launch-icon" aria-hidden="true"><Bot size={20} strokeWidth={1.8} /></span>
        <input
          type="text" dir="auto" maxLength={4000} value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="مثال: افحص جهازي وحدد المشاكل المحتملة…"
          aria-label="اكتب هدفك لـ WORA" disabled={busy}
        />
        <button type="submit" className="button primary" disabled={busy || !objective.trim()}>
          {busy ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} نفّذ
        </button>
      </form>
      <div className="os-examples" aria-label="أمثلة">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="os-chip" onClick={() => void launch(example)} disabled={busy} dir="auto">{example}</button>
        ))}
      </div>

      <div className="os-exec-layout">
        <aside className="os-mission-list panel" aria-label="المهمات">
          <h2>المهمات</h2>
          {missions === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
          {missions?.length === 0 && (
            <div className="os-empty">
              <FlaskConical size={26} aria-hidden="true" />
              <p>لا توجد مهمات بعد. اكتب هدفًا أعلاه — كل مهمة تُنفذ وتحفظ هنا بحالة حقيقية وأدلة.</p>
            </div>
          )}
          {missions?.map((mission) => (
            <button key={mission.id} type="button" className={`os-mission-item${mission.id === selectedId ? ' is-active' : ''}`} onClick={() => setSelectedId(mission.id)} aria-pressed={mission.id === selectedId}>
              <span className="os-mission-objective" dir="auto">{mission.objective}</span>
              <span className="os-mission-meta"><StatusPill status={mission.status} /><small className="subtle">{relTime(mission.updatedAt)}</small></span>
            </button>
          ))}
        </aside>

        <section className="os-mission-detail panel" aria-label="تفاصيل المهمة">
          {!selected && <div className="os-empty"><ArrowRight size={22} aria-hidden="true" /><p>اختر مهمة من القائمة لعرض خطتها ومراحل تنفيذها وأدلتها.</p></div>}
          {selected && detail && (
            <>
              <div className="os-detail-head">
                <h2 dir="auto">{detail.objective}</h2>
                <div className="os-detail-meta">
                  <StatusPill status={detail.status} />
                  {taskProgress && <span className="subtle">{taskProgress.done}/{taskProgress.total} مهام مكتملة</span>}
                  <small className="subtle mono">{detail.id}</small>
                </div>
                {detail.summary && <p className="subtle">{detail.summary}</p>}
                {detail.artifacts.length > 0 && (
                  <div className="os-artifacts">
                    {detail.artifacts.map((artifact) => (
                      <button key={artifact.id} type="button" className="button small" onClick={() => void downloadArtifact(artifact.id)}>
                        <Download size={13} aria-hidden="true" /> {artifact.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <ol className="os-task-list">
                {detail.tasks.map((task) => <li key={task.id}><TaskRow task={task} /></li>)}
              </ol>
              {detail.handoffs.length > 0 && (
                <details className="os-handoffs">
                  <summary><ScrollText size={14} aria-hidden="true" /> عقود التسليم ({detail.handoffs.length})</summary>
                  {detail.handoffs.map((handoff) => (
                    <pre key={handoff.id} className="os-pre">{JSON.stringify(handoff.contract, null, 2)}</pre>
                  ))}
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
