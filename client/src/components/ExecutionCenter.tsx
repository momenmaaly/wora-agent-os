import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Ban, Bot, CheckCircle2, ChevronDown, ChevronLeft, Circle, CircleAlert,
  Check, Download, FileText, FlaskConical, GitBranch, LoaderCircle, Network, Pause, Play, RefreshCw, Rocket, ScrollText, ShieldAlert, ShieldCheck, Wrench, X, XCircle,
} from 'lucide-react';
import { OsApiError, osApi, type ApprovalRecord, type MissionDetail, type MissionSummary, type OsTask, type TaskLease, type VerificationRecord } from '../os/api.js';

const STATUS_LABEL: Record<MissionSummary['status'], string> = {
  planning: 'يخطط', running: 'قيد التنفيذ', paused: 'متوقفة مؤقتًا', awaiting_approval: 'بانتظار موافقتك', completed: 'مكتملة', failed: 'متعثرة', cancelled: 'ملغاة',
};
const TASK_STATUS_LABEL: Record<OsTask['status'], string> = {
  created: 'منشأة', planned: 'مخططة', assigned: 'مُسندة', running: 'قيد التنفيذ', reviewing: 'قيد المراجعة', completed: 'مكتملة', failed: 'فشلت', blocked: 'محظورة', cancelled: 'ملغاة',
};
const TASK_ICON: Record<OsTask['status'], typeof CheckCircle2> = {
  created: Circle, planned: Circle, assigned: Circle, running: LoaderCircle, reviewing: LoaderCircle,
  completed: CheckCircle2, failed: XCircle, blocked: CircleAlert, cancelled: Ban,
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

function PendingApproval({ approval, onDecide }: { approval: ApprovalRecord; onDecide: (id: string, decision: 'approved' | 'denied') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approved' | 'denied') => {
    if (busy) return;
    setBusy(true);
    try { await onDecide(approval.id, decision); } finally { setBusy(false); }
  };
  return (
    <div className="os-approval" role="alert">
      <div className="os-approval-head">
        <ShieldAlert size={16} aria-hidden="true" />
        <strong>بانتظار موافقتك</strong>
        <span className="os-risk-chip">{approval.toolId ?? approval.kind} · {approval.risk === 'high' ? 'خطورة عالية' : approval.risk}</span>
      </div>
      <p dir="auto">{approval.actionSummary}</p>
      <dl className="os-approval-review">
        {approval.target && <><dt>الهدف</dt><dd dir="auto">{approval.target}</dd></>}
        {approval.consequences && <><dt>الأثر</dt><dd dir="auto">{approval.consequences}</dd></>}
        {approval.resourceImpact && <><dt>الموارد</dt><dd dir="auto">{approval.resourceImpact}</dd></>}
      </dl>
      <div className="os-detail-meta">
        {approval.actionClass && <span className="os-risk-chip">فئة {approval.actionClass}</span>}
        {approval.amountUsd != null && <span className="os-risk-chip">مبلغ {approval.amountUsd} USD</span>}
        {approval.expiresAt && <small className="subtle">تنتهي {new Date(approval.expiresAt).toLocaleString('ar')}</small>}
      </div>
      {approval.scope && <small className="subtle mono" dir="ltr">{approval.scope}</small>}
      {approval.payloadDigest && <small className="subtle mono" dir="ltr">digest: {approval.payloadDigest.slice(0, 24)}…</small>}
      {approval.reviewDigest && <small className="subtle mono" dir="ltr">review: {approval.reviewDigest.slice(0, 24)}…</small>}
      <details>
        <summary>الحمولة الدقيقة (المعتمدة عند الموافقة)</summary>
        <pre className="os-pre">{JSON.stringify(approval.toolInput, null, 2).slice(0, 2500)}</pre>
      </details>
      <div className="os-approval-actions">
        <button type="button" className="button primary small" disabled={busy} onClick={() => void decide('approved')}>
          {busy ? <LoaderCircle size={13} className="os-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />} وافق ونفّذ
        </button>
        <button type="button" className="button ghost small danger" disabled={busy} onClick={() => void decide('denied')}>
          <X size={13} aria-hidden="true" /> ارفض
        </button>
      </div>
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
  const [leases, setLeases] = useState<TaskLease[]>([]);
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  const [replanReason, setReplanReason] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [composite, setComposite] = useState(false);

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
    try {
      const [mission, leaseList, verificationList] = await Promise.all([
        osApi.mission(id), osApi.missionLeases(id), osApi.missionVerifications(id),
      ]);
      setDetail(mission);
      setLeases(leaseList);
      setVerifications(verificationList);
    } catch { /* transient poll failure */ }
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

  const anyRunning = (missions ?? []).some((m) => m.status === 'planning' || m.status === 'running' || m.status === 'awaiting_approval') || detail?.status === 'running' || detail?.status === 'planning' || detail?.status === 'awaiting_approval';
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
      const created = await osApi.launchMission(trimmed, composite ? 'composite' : undefined);
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

  async function resumeMission() {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const updated = await osApi.resumeMission(selectedId);
      setDetail(updated);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر استئناف المهمة.');
    } finally {
      setBusy(false);
    }
  }

  async function pauseMission() {
    if (!selectedId || busy) return;
    setBusy(true);
    try { setDetail(await osApi.pauseMission(selectedId)); await refreshMissions(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر إيقاف المهمة مؤقتًا.'); }
    finally { setBusy(false); }
  }

  async function cancelMission() {
    if (!selectedId || busy || !window.confirm('إلغاء المهمة نهائيًا؟ ستبقى المخرجات والأدلة السابقة محفوظة، لكن لن يُقبل أي تنفيذ لاحق.')) return;
    setBusy(true);
    try { setDetail(await osApi.cancelMission(selectedId)); await refreshMissions(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر إلغاء المهمة.'); }
    finally { setBusy(false); }
  }

  async function executeParallel() {
    if (!selectedId || busy) return;
    setBusy(true);
    try { setDetail(await osApi.executeMission(selectedId, concurrency)); await refreshMissions(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تشغيل المهمة.'); }
    finally { setBusy(false); }
  }

  async function replan() {
    if (!selectedId || busy || replanReason.trim().length < 3) return;
    setBusy(true);
    try { await osApi.replanMission(selectedId, replanReason.trim()); setReplanReason(''); await refreshDetail(selectedId); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر إنشاء خطة بديلة.'); }
    finally { setBusy(false); }
  }

  async function decideApproval(approvalId: string, decision: 'approved' | 'denied') {
    try {
      await osApi.decideApproval(approvalId, decision);
      if (selectedId) await refreshDetail(selectedId);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تسجيل القرار.');
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
        <label className="os-inline-control" title="يبني خطة من القدرات المعتمدة المتاحة ويسجل الفجوات بدل اختلاقها">
          <input type="checkbox" checked={composite} onChange={(event) => setComposite(event.target.checked)} disabled={busy} />
          تركيب القدرات
        </label>
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
                  {(detail.status === 'failed' || detail.status === 'awaiting_approval' || detail.status === 'planning' || detail.status === 'paused') && (
                    <button type="button" className="button ghost small" onClick={() => void resumeMission()} disabled={busy}>
                      <Play size={12} aria-hidden="true" /> استئناف
                    </button>
                  )}
                  {(detail.status === 'running' || detail.status === 'planning' || detail.status === 'awaiting_approval') && (
                    <button type="button" className="button ghost small" onClick={() => void pauseMission()} disabled={busy}>
                      <Pause size={12} aria-hidden="true" /> إيقاف مؤقت
                    </button>
                  )}
                  {detail.status !== 'completed' && detail.status !== 'cancelled' && (
                    <button type="button" className="button ghost small danger" onClick={() => void cancelMission()} disabled={busy}>
                      <Ban size={12} aria-hidden="true" /> إلغاء
                    </button>
                  )}
                  <label className="os-inline-control">
                    <Network size={12} aria-hidden="true" />
                    <select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} aria-label="عدد العمال المتوازيين" disabled={busy}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <button type="button" className="button ghost small" onClick={() => void executeParallel()} disabled={busy}>تشغيل</button>
                  </label>
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
                {(detail.approvals ?? []).filter((a) => a.status === 'pending').map((approval) => (
                  <PendingApproval key={approval.id} approval={approval} onDecide={decideApproval} />
                ))}
              </div>
              <ol className="os-task-list">
                {detail.tasks.map((task) => <li key={task.id}><TaskRow task={task} /></li>)}
              </ol>

              {detail.problemProfile && (
                <details className="os-handoffs" open>
                  <summary><GitBranch size={14} aria-hidden="true" /> فهم المشكلة واختيار الخوارزمية</summary>
                  <div className="os-columns">
                    <div>
                      <p><strong>المجال:</strong> {detail.problemProfile.domain} · <strong>الثقة:</strong> {Math.round(detail.problemProfile.confidence * 100)}%</p>
                      <p><strong>الخوارزمية:</strong> {detail.problemProfile.algorithmSelection.primary?.name ?? 'غير محسومة'} ({detail.problemProfile.algorithmSelection.primary?.toolId ?? '—'})</p>
                      <p className="subtle">{detail.problemProfile.algorithmSelection.primary?.guarantee ?? detail.problemProfile.algorithmSelection.rationale.join(' ')}</p>
                    </div>
                    <div>
                      <h4>قيود مستخرجة</h4>
                      <ul className="os-acceptance">{detail.problemProfile.constraints.map((item) => <li key={item}>{item}</li>)}</ul>
                      <h4>معلومات ناقصة</h4>
                      <ul className="os-acceptance">{detail.problemProfile.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </details>
              )}

              {detail.problemModel && (
                <details className="os-handoffs" open>
                  <summary><FlaskConical size={14} aria-hidden="true" /> المشكلة الموحدة: ما نعرفه وما نفترضه وما ينقص</summary>
                  <div className="os-columns">
                    <div>
                      <p><strong>المجال:</strong> {detail.problemModel.domain} · <strong>الهدف:</strong> {detail.problemModel.desiredOutcome}</p>
                      <p><strong>الثقة:</strong> {Math.round(detail.problemModel.confidence * 100)}% · <strong>المخاطر:</strong> {detail.problemModel.risk} · <strong>قابلية العكس:</strong> {detail.problemModel.reversibility}</p>
                      <p><strong>الاحتياجات:</strong> {detail.problemModel.needs.join('، ') || '—'}</p>
                      <h4>حقائق من طلبك</h4>
                      <ul className="os-acceptance">{detail.problemModel.facts.map((fact) => <li key={fact.id}><span className="subtle">[{fact.provenance}]</span> {fact.statement}</li>)}</ul>
                      {detail.problemModel.evidence.length > 0 && <><h4>أدلة مسترجعة</h4><ul className="os-acceptance">{detail.problemModel.evidence.map((item) => <li key={item.id}>{item.statement} <span className="subtle">({item.source})</span></li>)}</ul></>}
                    </div>
                    <div>
                      <h4>افتراضات معلنة</h4>
                      <ul className="os-acceptance">{detail.problemModel.assumptions.map((item) => <li key={item.id}>{item.statement}</li>)}</ul>
                      <h4>معلومات ناقصة</h4>
                      {detail.problemModel.unknowns.length ? <ul className="os-acceptance">{detail.problemModel.unknowns.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle">لا توجد معلومات ناقصة مسجلة.</p>}
                      <h4>الطريقة العلمية</h4>
                      <p>{detail.problemModel.methods.selected ? `${detail.problemModel.methods.selected.name} (${detail.problemModel.methods.selected.toolId ?? '—'})` : 'لم تُحدد طريقة قابلة للتنفيذ.'}</p>
                      {detail.problemModel.methods.rejected.length > 0 && <ul className="os-acceptance">{detail.problemModel.methods.rejected.map((item) => <li key={item.name}>{item.name}: {item.reason}</li>)}</ul>}
                    </div>
                  </div>
                </details>
              )}

              {detail.reasoning && (
                <details className="os-handoffs" open>
                  <summary><FlaskConical size={14} aria-hidden="true" /> الفهم الاستدلالي: ما نعرفه، وما نفترضه، وما ينقص</summary>
                  <p>
                    <strong>الوضع:</strong> {detail.reasoning.mode === 'model-assisted' ? 'مدعوم بنموذج اختياري (مقترحات غير متحقق منها)' : detail.reasoning.mode === 'deterministic-fallback' ? 'احتياطي حتمي بعد فشل المزوّد' : 'حتمي بدون مزوّد خارجي'}
                    {' · '}<strong>الإصدار:</strong> {detail.reasoning.version}
                    {' · '}<strong>نوع المشكلة:</strong> {detail.reasoning.problemType}
                    {' · '}<strong>الثقة:</strong> {Math.round(detail.reasoning.confidence.value * 100)}% ({detail.reasoning.confidence.kind})
                  </p>
                  <p><strong>النتيجة المقصودة:</strong> {detail.reasoning.desiredOutcome}</p>
                  {detail.reasoning.problemStructure?.forecasting && (
                    <div className="os-subpanel" aria-label="بنية مسألة التنبؤ">
                      <p><strong>بنية المسألة:</strong> تنبؤ · الهدف <span dir="ltr">{detail.reasoning.problemStructure.forecasting.targetVariable ?? 'غير محدد'}</span> · الأفق <span dir="ltr">{detail.reasoning.problemStructure.forecasting.horizon?.steps ?? 'غير محدد'}</span> {detail.reasoning.problemStructure.forecasting.horizon?.unit ?? ''} · الملاحظات <span dir="ltr">{detail.reasoning.problemStructure.forecasting.observations.length}</span></p>
                      <p className={detail.reasoning.problemStructure.forecasting.canExecute ? 'subtle' : 'os-warning'}>
                        {detail.reasoning.problemStructure.forecasting.canExecute ? 'المدخلات المطلوبة مكتملة؛ يمكن تنفيذ الطريقة المطبقة.' : `لا يمكن تنفيذ تنبؤ الآن. المدخلات الناقصة: ${detail.reasoning.problemStructure.forecasting.missingInputs.join('، ') || 'غير محددة'}. لم يتم اختراع أي بيانات.`}
                      </p>
                      {detail.reasoning.problemStructure.forecasting.conflictingRecords && <p className="os-warning">السجلات التاريخية متعارضة؛ لن تُختار سلسلة موثوقة تلقائيًا.</p>}
                      {detail.reasoning.problemStructure.forecasting.extractionNotes.length > 0 && <ul className="os-acceptance">{detail.reasoning.problemStructure.forecasting.extractionNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
                    </div>
                  )}
                  <p className={detail.reasoning.sufficientToProceed ? 'subtle' : 'os-warning'}>
                    {detail.reasoning.sufficientToProceed ? 'المعلومات الحالية كافية للمتابعة الحتمية؛ لا سؤال إضافي إلزامي.' : 'توجد معلومات حرجة ناقصة؛ لا ينبغي اختراع إجابة.'}
                  </p>
                  {detail.reasoning.clarificationQuestion && <p className="os-warning"><strong>السؤال المطلوب:</strong> {detail.reasoning.clarificationQuestion}</p>}
                  <div className="os-columns">
                    <div>
                      <h4>حقائق المستخدم ({detail.reasoning.claims.filter((item) => item.kind === 'user-fact').length})</h4>
                      <ul className="os-acceptance">{detail.reasoning.claims.filter((item) => item.kind === 'user-fact').slice(0, 8).map((item) => <li key={item.id}>{item.statement} <span className="subtle">[{item.provenance.trust}]</span></li>)}</ul>
                      <h4>افتراضات معلنة ({detail.reasoning.assumptions.length})</h4>
                      {detail.reasoning.assumptions.length ? <ul className="os-acceptance">{detail.reasoning.assumptions.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle">لا افتراضات مسجلة.</p>}
                      <h4>معلومات ناقصة ({detail.reasoning.unknowns.length})</h4>
                      {detail.reasoning.unknowns.length ? <ul className="os-acceptance">{detail.reasoning.unknowns.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle">لا معلومات ناقصة مسجلة.</p>}
                    </div>
                    <div>
                      <h4>فرضيات مرشحة ({detail.reasoning.hypotheses.length})</h4>
                      {detail.reasoning.hypotheses.length ? <ul className="os-acceptance">{detail.reasoning.hypotheses.slice(0, 6).map((item) => <li key={item.id}><strong>{item.rank}. {item.status}</strong> · {item.statement} <span className="subtle">(درجة {item.score} · {item.scoreKind === 'heuristic-uncalibrated' ? 'غير معايرة' : item.scoreKind})</span>{item.rejectionReason ? <span className="subtle"> — {item.rejectionReason}</span> : null}</li>)}</ul> : <p className="subtle">لا توجد فرضيات؛ المشكلة محددة بما يكفي أو لا توجد أسباب محتملة متعددة.</p>}
                      <h4>سببية</h4>
                      {detail.reasoning.causalGraph.length ? <ul className="os-acceptance">{detail.reasoning.causalGraph.slice(0, 6).map((edge) => <li key={edge.id}>{edge.cause} ← {edge.relation} → {edge.effect} <span className="subtle">({edge.evidenceKind} · {edge.identified ? 'مُعرّف' : 'غير مُعرّف'})</span><br /><small className="subtle">{edge.limitation}</small></li>)}</ul> : <p className="subtle">لا توجد علاقات سببية مستخرجة؛ لا ندّعي سببية غير مدعومة.</p>}
                    </div>
                  </div>
                  <div className="os-columns">
                    <div>
                      <h4>معلومات مطلوبة</h4>
                      {detail.reasoning.informationNeeds.length ? <ul className="os-acceptance">{detail.reasoning.informationNeeds.slice(0, 8).map((need) => <li key={need.id}><strong>{need.materiality}</strong> · {need.question} <span className="subtle">({need.recommendedAction} · {need.canSelfGather ? 'يمكن جمعها داخليًا' : 'تتطلب المستخدم'} · كسب متوقع {Math.round(need.expectedInformationGain * 100)}%)</span></li>)}</ul> : <p className="subtle">لا حاجة معلومات مفتوحة.</p>}
                    </div>
                    <div>
                      <h4>الطرق العلمية</h4>
                      <ul className="os-acceptance">{detail.reasoning.methods.slice(0, 8).map((method) => <li key={method.id}><strong>{method.name}</strong> {method.selected ? '· مختارة' : ''} · {method.status}{method.gap ? ` · فجوة: ${method.gap}` : ''}<br /><small className="subtle">{method.reason}</small></li>)}</ul>
                    </div>
                  </div>
                  {detail.reasoning.contradictions.length > 0 && <><h4>تناقضات تحتاج حسمًا</h4><ul className="os-acceptance">{detail.reasoning.contradictions.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul></>}
                  {detail.reasoning.changes.length > 0 && <><h4>آخر تحديث للفهم</h4><ul className="os-acceptance">{detail.reasoning.changes.slice(-4).map((change) => <li key={`${change.version}-${change.kind}`}>v{change.version} · {change.kind} · {change.description}{change.replanRecommended ? ' · يوصى بإعادة التخطيط' : ''}</li>)}</ul></>}
                  {detail.reasoning.limitations.length > 0 && <><h4>حدود الاستدلال</h4><ul className="os-acceptance">{detail.reasoning.limitations.map((item) => <li key={item}>{item}</li>)}</ul></>}
                  {detail.reasoning.provider.notice && <p className="subtle">{detail.reasoning.provider.notice}</p>}
                </details>
              )}

              {detail.outcomeVerification && (
                <div className="os-subpanel" aria-label="التحقق من النتيجة">
                  <h3><FlaskConical size={15} aria-hidden="true" /> التحقق المستقل من النتيجة</h3>
                  <p><strong>الحالة:</strong> {detail.outcomeStatus ?? detail.outcomeVerification.status}</p>
                  {(detail.outcomeVerification.reasons ?? []).length > 0 && <ul className="os-acceptance">{(detail.outcomeVerification.reasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  <ul className="os-acceptance">
                    {(detail.outcomeVerification.checks ?? []).slice(0, 24).map((check) => (
                      <li key={check.id}><strong>{check.status}</strong> · {check.description} <span className="subtle">({check.evidence})</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.composition && (
                <details className="os-handoffs" open>
                  <summary><Network size={14} aria-hidden="true" /> تركيب القدرات والاستراتيجية المختارة</summary>
                  <p className="subtle">{detail.composition.graph.explanation}</p>
                  <p><strong>الاستراتيجية:</strong> {detail.composition.strategies.find((strategy) => strategy.id === detail.composition?.selectedStrategy)?.name ?? detail.composition.selectedStrategy ?? '—'}</p>
                  <p className="subtle">{detail.composition.explanation}</p>
                  <ul className="os-acceptance">
                    {detail.composition.graph.nodes.map((node) => (
                      <li key={node.id}><strong>{node.title}</strong> — {node.tool} · {node.role} · {node.capabilityKind} · وكيل {node.agentId ?? 'غير محدد'} · مخاطر {node.risk}{node.fallbackTools.length ? ` · بديل متوافق: ${node.fallbackTools.join('، ')}` : ''}</li>
                    ))}
                  </ul>
                  {detail.composition.gaps.length > 0 && <><h4>فجوات حقيقية</h4><ul className="os-acceptance">{detail.composition.gaps.map((gap) => <li key={`${gap.node ?? 'global'}-${gap.message}`}>{gap.message} <span className="subtle">({gap.missing.join('، ')})</span></li>)}</ul></>}
                  {detail.composition.strategies.length > 0 && <><h4>بدائل مقارنة</h4><ul className="os-acceptance">{detail.composition.strategies.map((strategy) => <li key={strategy.id}><strong>{strategy.name}</strong> — {strategy.feasible ? `قابلة للتنفيذ · ${strategy.score}` : `مرفوضة · ${strategy.rejectionReason ?? 'غير قابلة للتنفيذ'}`}</li>)}</ul></>}
                </details>
              )}

              {detail.planVersions && detail.planVersions.length > 0 && (
                <details className="os-handoffs">
                  <summary><GitBranch size={14} aria-hidden="true" /> إصدارات الخطة ({detail.planVersions.length})</summary>
                  {detail.planVersions.map((version) => (
                    <div key={version.id} className="os-run">
                      <div className="os-run-head"><strong>v{version.version} · {version.strategy}</strong><span className="subtle">{version.reason}</span><small className="subtle">{new Date(version.createdAt).toLocaleString('ar')}</small></div>
                      <p className="subtle">تكلفة تقديرية {version.plan.metrics.totalCost} · مخاطر {version.plan.metrics.maxRisk} · مسار حرج {version.plan.criticalPath.join(' → ')}</p>
                      <ul className="os-acceptance">
                        {version.plan.tasks.map((task) => <li key={task.index}><strong>{task.title}</strong> — {task.uncertainty.risk} · {task.preconditions.join('؛ ')}</li>)}
                      </ul>
                    </div>
                  ))}
                </details>
              )}

              {detail.planVerification && (
                <details className="os-handoffs">
                  <summary><ShieldCheck size={14} aria-hidden="true" /> تحقق بنية الخطة ({detail.planVerification.passed ? 'سليم' : 'فشل'})</summary>
                  <ul className="os-acceptance">
                    {detail.planVerification.checks.map((check) => <li key={check.id}><strong>{check.id}</strong>: {check.status} — {check.evidence}</li>)}
                  </ul>
                </details>
              )}

              <details className="os-handoffs">
                <summary><Network size={14} aria-hidden="true" /> العمال والعقود ({leases.length})</summary>
                {leases.length === 0 ? <p className="subtle">لا يوجد عامل يحمل عقد مهمة الآن.</p> : (
                  <ul className="os-acceptance">
                    {leases.map((lease) => <li key={lease.taskId}><code dir="ltr">{lease.ownerId}</code> · مهمة {lease.taskId.slice(0, 8)}… · تنتهي {new Date(lease.expiresAt).toLocaleTimeString('ar')}</li>)}
                  </ul>
                )}
              </details>

              <details className="os-handoffs">
                <summary><ShieldCheck size={14} aria-hidden="true" /> سجل التحقق المستقل ({verifications.length})</summary>
                {verifications.map((verification) => (
                  <div key={verification.id} className="os-run">
                    <div className="os-run-head"><strong>{verification.result} · {verification.independence}</strong><span className="subtle">{verification.verifier}</span><small className="subtle">{new Date(verification.createdAt).toLocaleString('ar')}</small></div>
                    {verification.failureReason && <p className="os-issues">{verification.failureReason}</p>}
                    <ul className="os-acceptance">
                      {verification.checks.map((check) => <li key={check.id}><strong>{check.id}</strong>: {check.status}{check.evidence ? ` — ${check.evidence}` : ''}</li>)}
                    </ul>
                  </div>
                ))}
              </details>

              <form className="os-memory-row" onSubmit={(event) => { event.preventDefault(); void replan(); }}>
                <input dir="auto" value={replanReason} onChange={(event) => setReplanReason(event.target.value)} placeholder="سبب إعادة التخطيط (مثال: فشل مهمة سابقة)" maxLength={500} aria-label="سبب إعادة التخطيط" />
                <button type="submit" className="button small" disabled={busy || replanReason.trim().length < 3}>إعادة تخطيط المتبقي</button>
              </form>

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
