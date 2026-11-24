import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Boxes, BrainCircuit, CheckCircle2, CircleAlert, FlaskConical, GraduationCap, LoaderCircle, Play, Plus, Scale, ShieldAlert, Trash2, Wrench,
} from 'lucide-react';
import {
  OsApiError, osApi,
  type BenchmarkRun, type DecisionResult, type Lesson, type LessonEvent, type MonteCarloResult, type ScheduleRequest, type ScheduleResult, type ToolInfo,
  type TwinRecord, type TwinScenarioResult, type TwinDriverInput,
} from '../os/api.js';

type Tab = 'schedule' | 'montecarlo' | 'decision' | 'tools' | 'playbooks' | 'twins' | 'lessons' | 'benchmarks';

type EditableEmployee = ScheduleRequest['employees'][number] & { name: string };

const SHIFT_DEFAULTS = [
  { id: 'morning', name: 'Morning (06–14)', demand: 5 },
  { id: 'afternoon', name: 'Afternoon (12–20)', demand: 4 },
  { id: 'evening', name: 'Evening (14–22)', demand: 4 },
  { id: 'night', name: 'Night (22–06)', demand: 4 },
  { id: 'weekend', name: 'Weekend flex', demand: 3 },
];

export function IntelligenceHub() {
  const [tab, setTab] = useState<Tab>('schedule');
  const [error, setError] = useState<string | null>(null);

  /* ─── Employee scheduling ─── */
  const [employees, setEmployees] = useState<EditableEmployee[]>([]);
  const [shifts, setShifts] = useState(SHIFT_DEFAULTS);
  const [sampleNote, setSampleNote] = useState<string | null>(null);
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [solving, setSolving] = useState(false);

  const loadSample = useCallback(async () => {
    setError(null);
    try {
      const sample = await osApi.sampleEmployeeSchedule();
      setEmployees(sample.employees.map((e) => ({ ...e })));
      setShifts(sample.shifts);
      setSampleNote(sample.note);
      setScheduleResult(null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحميل بيانات العينة.');
    }
  }, []);

  useEffect(() => { void loadSample(); }, [loadSample]);

  const totalDemand = shifts.reduce((acc, s) => acc + s.demand, 0);
  const solve = async () => {
    setSolving(true);
    setError(null);
    try {
      setScheduleResult(await osApi.employeeSchedule({ employees, shifts }));
    } catch (err) {
      setScheduleResult(null);
      setError(err instanceof OsApiError ? err.message : 'تعذر حل النموذج.');
    } finally {
      setSolving(false);
    }
  };

  const toggleAvailability = (index: number, shiftId: string) => {
    setEmployees((current) => current.map((e, i) => i === index
      ? { ...e, availability: e.availability.includes(shiftId) ? e.availability.filter((s) => s !== shiftId) : [...e.availability, shiftId] }
      : e));
  };

  /* ─── Monte Carlo ─── */
  const [mcItems, setMcItems] = useState([
    { name: 'التخطيط', optimistic: 3, likely: 5, pessimistic: 9 },
    { name: 'التنفيذ', optimistic: 8, likely: 13, pessimistic: 22 },
    { name: 'الاختبار', optimistic: 2, likely: 4, pessimistic: 8 },
  ]);
  const [trials, setTrials] = useState(10000);
  const [seed, setSeed] = useState(42);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcBusy, setMcBusy] = useState(false);

  const runMc = async () => {
    setMcBusy(true);
    setError(null);
    try {
      const res = await osApi.monteCarlo({ trials, seed, items: mcItems });
      if (res.ok && res.output) setMcResult(res.output);
      else setError(res.error ?? 'فشلت المحاكاة.');
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تشغيل المحاكاة.');
    } finally {
      setMcBusy(false);
    }
  };
  const histogramMax = mcResult ? Math.max(...mcResult.histogram.map((h) => h.count), 1) : 1;

  /* ─── Decision matrix ─── */
  const [criteria, setCriteria] = useState<Array<{ id: string; label: string; weight: number }>>([
    { id: 'c1', label: 'التكلفة', weight: 5 },
    { id: 'c2', label: 'السرعة', weight: 3 },
    { id: 'c3', label: 'الجودة', weight: 4 },
  ]);
  const [alternatives, setAlternatives] = useState<Array<{ name: string; scores: Record<string, number> }>>([
    { name: 'الخيار أ', scores: { c1: 7, c2: 5, c3: 8 } },
    { name: 'الخيار ب', scores: { c1: 5, c2: 8, c3: 6 } },
    { name: 'الخيار ج', scores: { c1: 8, c2: 7, c3: 5 } },
  ]);
  const [decisionResult, setDecisionResult] = useState<DecisionResult | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);

  const runDecision = async () => {
    setDecisionBusy(true);
    setError(null);
    try {
      const res = await osApi.decisionMatrix({ criteria, alternatives });
      if (res.ok && res.output) setDecisionResult(res.output);
      else setError(res.error ?? 'فشلت مصفوفة القرار.');
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تشغيل مصفوفة القرار.');
    } finally {
      setDecisionBusy(false);
    }
  };

  /* ─── Digital twins ─── */
  const [twins, setTwins] = useState<TwinRecord[] | null>(null);
  const [selectedTwinId, setSelectedTwinId] = useState<string | null>(null);
  const [twinName, setTwinName] = useState('');
  const [twinEntityType, setTwinEntityType] = useState('operation');
  const [twinDrivers, setTwinDrivers] = useState<TwinDriverInput[]>([
    { name: 'العجلة اليومية', optimistic: 80, likely: 120, pessimistic: 160 },
  ]);
  const [twinBusy, setTwinBusy] = useState(false);
  const [observationText, setObservationText] = useState('');
  const [scenarioName, setScenarioName] = useState('سيناريو توسعة');
  const [scenarioAdjustments, setScenarioAdjustments] = useState<Record<string, { op: 'mul' | 'add'; value: number } | undefined>>({});
  const [scenarioResult, setScenarioResult] = useState<TwinScenarioResult | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  const refreshTwins = useCallback(async () => {
    try {
      const list = await osApi.twins();
      setTwins(list);
      setSelectedTwinId((current) => current ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحميل التوائم الرقمية.');
    }
  }, []);

  useEffect(() => {
    if (tab !== 'twins' || twins !== null) return;
    void refreshTwins();
  }, [tab, twins, refreshTwins]);

  const selectedTwin = twins?.find((twin) => twin.id === selectedTwinId) ?? null;

  const createTwin = async () => {
    const drivers = twinDrivers.filter((driver) => driver.name.trim());
    if (!twinName.trim() || drivers.length === 0) { setError('سمِّ التوأم وأضف محركًا واحدًا على الأقل.'); return; }
    setTwinBusy(true);
    setError(null);
    try {
      const created = await osApi.createTwin({ name: twinName.trim(), entityType: twinEntityType, drivers });
      setTwinName('');
      setTwinDrivers([{ name: 'محرك جديد', optimistic: 1, likely: 2, pessimistic: 4 }]);
      await refreshTwins();
      setSelectedTwinId(created.id);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر إنشاء التوأم.');
    } finally {
      setTwinBusy(false);
    }
  };

  const recordObservation = async () => {
    if (!selectedTwin || !observationText.trim()) return;
    setTwinBusy(true);
    try {
      await osApi.recordTwinObservation(selectedTwin.id, { note: observationText.trim() });
      setObservationText('');
      await refreshTwins();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تسجيل الملاحظة.');
    } finally {
      setTwinBusy(false);
    }
  };

  const runScenario = async () => {
    if (!selectedTwin) return;
    const adjustments = Object.entries(scenarioAdjustments)
      .filter((entry): entry is [string, { op: 'mul' | 'add'; value: number }] => Boolean(entry[1]) && Number.isFinite(entry[1]!.value))
      .map(([driver, adj]) => ({ driver, op: adj.op, value: adj.value }));
    if (adjustments.length === 0) { setError('اضبط محركًا واحدًا على الأقل للسيناريو.'); return; }
    setScenarioBusy(true);
    setError(null);
    try {
      setScenarioResult(await osApi.runTwinScenario(selectedTwin.id, { name: scenarioName.trim() || 'سيناريو', adjustments, trials: 5000, seed: 42 }));
      await refreshTwins();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تشغيل السيناريو.');
    } finally {
      setScenarioBusy(false);
    }
  };

  /* ─── Lessons ─── */
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [lessonStatus, setLessonStatus] = useState<Lesson['status'] | 'all'>('all');
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonHistory, setLessonHistory] = useState<Record<string, LessonEvent[]>>({});
  const loadLessons = useCallback(async (status: Lesson['status'] | 'all') => {
    setLessonBusy(true);
    try { setLessons(await osApi.lessons(status)); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحميل الدروس.'); }
    finally { setLessonBusy(false); }
  }, []);
  useEffect(() => { if (tab === 'lessons' && lessons === null) void loadLessons(lessonStatus); }, [tab, lessons, lessonStatus, loadLessons]);
  async function lessonAction(id: string, action: 'evaluate' | 'promote' | 'reject' | 'revoke' | 'success' | 'failure') {
    if (lessonBusy) return;
    setLessonBusy(true);
    try {
      if (action === 'evaluate') await osApi.evaluateLesson(id);
      else if (action === 'promote') await osApi.promoteLesson(id);
      else if (action === 'reject') { const reason = window.prompt('سبب الرفض؟') ?? ''; if (!reason.trim()) return; await osApi.rejectLesson(id, reason.trim()); }
      else if (action === 'revoke') { const reason = window.prompt('سبب سحب الدرس من الذاكرة؟') ?? ''; if (!reason.trim()) return; await osApi.revokeLesson(id, reason.trim()); }
      else await osApi.recordLessonOutcome(id, action === 'success');
      await loadLessons(lessonStatus);
      setLessonHistory({});
    } catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تنفيذ إجراء الدرس.'); }
    finally { setLessonBusy(false); }
  }
  async function toggleLessonHistory(id: string) {
    if (lessonHistory[id]) { setLessonHistory((cur) => { const next = { ...cur }; delete next[id]; return next; }); return; }
    try { setLessonHistory((cur) => ({ ...cur, [id]: [] })); const events = await osApi.lessonHistory(id); setLessonHistory((cur) => ({ ...cur, [id]: events })); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحميل سجل الدرس.'); }
  }

  /* ─── Benchmarks ─── */
  const [benchmarks, setBenchmarks] = useState<BenchmarkRun[] | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkDomains, setBenchmarkDomains] = useState<Array<{ domain: string; implemented: string[]; partial: string[]; missing: string[] }> | null>(null);
  const loadBenchmarks = useCallback(async () => {
    setBenchmarkBusy(true);
    try {
      const [runs, domains] = await Promise.all([osApi.benchmarks(), osApi.benchmarkDomains()]);
      setBenchmarks(runs); setBenchmarkDomains(domains);
    } catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحميل المقاييس.'); }
    finally { setBenchmarkBusy(false); }
  }, []);
  useEffect(() => { if (tab === 'benchmarks' && benchmarks === null) void loadBenchmarks(); }, [tab, benchmarks, loadBenchmarks]);
  async function runBenchmarks() {
    setBenchmarkBusy(true);
    try { const run = await osApi.runBenchmarks(); setBenchmarks((current) => [run, ...(current ?? [])]); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تشغيل المقاييس.'); }
    finally { setBenchmarkBusy(false); }
  }

  /* ─── Tool registry ─── */
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  useEffect(() => {
    if (tab !== 'tools' || tools) return;
    osApi.tools().then(setTools).catch((err) => setError(err instanceof OsApiError ? err.message : 'تعذر تحميل سجل الأدوات.'));
  }, [tab, tools]);
  const [playbooks, setPlaybooks] = useState<import('../os/api.js').Playbook[] | null>(null);
  useEffect(() => {
    if (tab !== 'playbooks' || playbooks) return;
    osApi.playbooks().then(setPlaybooks).catch((err) => setError(err instanceof OsApiError ? err.message : 'تعذر تحميل الـ playbooks.'));
  }, [tab, playbooks]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof BrainCircuit }> = [
    { id: 'schedule', label: 'الجدولة التشغيلية', icon: BarChart3 },
    { id: 'montecarlo', label: 'مونتي كارلو', icon: FlaskConical },
    { id: 'decision', label: 'مصفوفة القرار', icon: Scale },
    { id: 'tools', label: 'سجل الأدوات', icon: Wrench },
    { id: 'playbooks', label: 'Playbooks', icon: CheckCircle2 },
    { id: 'twins', label: 'التوائم الرقمية', icon: Boxes },
    { id: 'lessons', label: 'الدروس', icon: GraduationCap },
    { id: 'benchmarks', label: 'المقاييس', icon: BarChart3 },
  ];

  return (
    <div className="os-page">
      <header className="os-page-head">
        <div>
          <h1><BrainCircuit size={20} aria-hidden="true" /> الذكاء التشغيلي</h1>
          <p className="subtle">حلّالون حقيقيون يعملون محليًا: HiGHS (LP/MIP)، خوارزمية Hungarian، محاكاة PERT مُبذورة، مصفوفات قرار مع اختبار متانة.</p>
        </div>
        <div className="os-tabs" role="tablist">
          {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`os-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}><t.icon size={14} aria-hidden="true" /> {t.label}</button>)}
        </div>
      </header>

      {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

      {tab === 'schedule' && (
        <div className="os-schedule">
          <div className="os-schedule-head">
            <div>
              <h2>تخصيص الموظفين للورديات (تقليل التكلفة)</h2>
              <p className="subtle">20 موظفًا × {shifts.length} ورديات. النموذج: xᵢⱼ ∈ {'{0,1}'}، تغطية الطلب، الالتزام بالتوفر، هدف: تقليل Σ تكلفة×تعيين. الحل عبر HiGHS MIP مع تحقق مستقل للقيود.</p>
              {sampleNote && <p className="os-sample-note"><FlaskConical size={12} aria-hidden="true" /> {sampleNote}</p>}
            </div>
            <div className="os-schedule-actions">
              <button type="button" className="button ghost small" onClick={() => void loadSample()}>إعادة بيانات العينة</button>
              <button type="button" className="button primary" disabled={solving || employees.length === 0} onClick={() => void solve()}>
                {solving ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} حلّ الآن
              </button>
            </div>
          </div>

          <div className="os-demand-row">
            <span className="os-demand-label">الطلب لكل وردية:</span>
            {shifts.map((shift) => (
              <label key={shift.id} className="os-demand-field"><span dir="auto">{shift.name}</span>
                <input type="number" min={0} max={5000} value={shift.demand} onChange={(e) => setShifts((cur) => cur.map((s) => s.id === shift.id ? { ...s, demand: Math.max(0, Number(e.target.value) || 0) } : s))} aria-label={`الطلب لـ ${shift.name}`} />
              </label>
            ))}
            <strong className="os-demand-total">الإجمالي: {totalDemand}</strong>
          </div>

          <div className="os-table-wrap panel">
            <table className="os-table">
              <thead><tr><th>الموظف (عينة)</th><th>تكلفة/ساعة</th>{shifts.map((s) => <th key={s.id} dir="auto">{s.name}</th>)}<th></th></tr></thead>
              <tbody>
                {employees.map((emp, index) => (
                  <tr key={emp.id}>
                    <td dir="auto">{emp.name}</td>
                    <td><input className="os-cost-input" type="number" min={0} max={100000} step="0.5" value={emp.hourlyCost} onChange={(e) => setEmployees((cur) => cur.map((x, i) => i === index ? { ...x, hourlyCost: Math.max(0, Number(e.target.value) || 0) } : x))} aria-label={`تكلفة ${emp.name}`} /></td>
                    {shifts.map((shift) => {
                      const on = emp.availability.includes(shift.id);
                      return <td key={shift.id}><button type="button" className={`os-avail${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleAvailability(index, shift.id)} aria-label={`توفر ${emp.name} لـ ${shift.name}`}>{on ? '✓' : '—'}</button></td>;
                    })}
                    <td><button type="button" className="icon-button" aria-label="إزالة" onClick={() => setEmployees((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="button small ghost" onClick={() => setEmployees((cur) => [...cur, { id: `emp-${Date.now()}`, name: `موظف ${cur.length + 1} (حقيقي)`, hourlyCost: 20, availability: shifts.map((s) => s.id), maxAssignments: 1 }])}><Plus size={14} aria-hidden="true" /> إضافة موظف</button>
          </div>

          {scheduleResult && (
            <div className="os-result panel panel-pad">
              <div className="os-result-head">
                {scheduleResult.feasible ? <CheckCircle2 size={18} className="os-ok" aria-hidden="true" /> : <CircleAlert size={18} className="os-bad" aria-hidden="true" />}
                <h3>{scheduleResult.feasible ? `حل أمثل — التكلفة الإجمالية ${scheduleResult.totalCost?.toFixed(2)}` : 'النموذج غير feasible بالقيود المعطاة'}</h3>
              </div>
              <div className="os-pershift">
                {scheduleResult.perShift.map((shift) => (
                  <div key={shift.shiftId} className={`os-shift-card${shift.meetsDemand ? '' : ' is-short'}`}>
                    <div className="os-shift-card-head"><strong dir="auto">{shift.shiftName}</strong><span className={shift.meetsDemand ? 'os-ok' : 'os-bad'}>{shift.assigned}/{shift.demand}</span></div>
                    <p dir="auto">{shift.employees.join('، ') || '—'}</p>
                  </div>
                ))}
              </div>
              <h4>تحقق مستقل للقيود (لا يثق بالحلّال)</h4>
              <ul className="os-validation">{scheduleResult.validation.map((line) => <li key={line}><CheckCircle2 size={12} aria-hidden="true" />{line}</li>)}</ul>
              <details><summary className="os-lp-summary">نموذج LP المولّد (HiGHS)</summary><pre className="os-pre">{scheduleResult.lp}</pre></details>
            </div>
          )}
        </div>
      )}

      {tab === 'montecarlo' && (
        <div className="os-mc">
          <div className="os-schedule-head">
            <div>
              <h2>محاكاة PERT ثلاثية النقاط (مكررة ومُبذورة)</h2>
              <p className="subtle">تقديرات متفائلة/محتملة/متشائمة لكل بند، ثم جمع عبر N محاكاة (مثلثات). النتائج تقدير محاكى — ليست قياسًا فعليًا.</p>
            </div>
            <button type="button" className="button primary" disabled={mcBusy} onClick={() => void runMc()}>{mcBusy ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} شغّل المحاكاة</button>
          </div>
          <div className="os-table-wrap panel">
            <table className="os-table">
              <thead><tr><th>البند</th><th>متفائل</th><th>محتمل</th><th>متشائم</th><th></th></tr></thead>
              <tbody>
                {mcItems.map((item, index) => (
                  <tr key={index}>
                    <td><input dir="auto" value={item.name} onChange={(e) => setMcItems((cur) => cur.map((x, i) => i === index ? { ...x, name: e.target.value } : x))} aria-label="اسم البند" /></td>
                    {(['optimistic', 'likely', 'pessimistic'] as const).map((key) => (
                      <td key={key}><input className="os-cost-input" type="number" step="0.5" value={item[key]} onChange={(e) => setMcItems((cur) => cur.map((x, i) => i === index ? { ...x, [key]: Number(e.target.value) || 0 } : x))} aria-label={key} /></td>
                    ))}
                    <td><button type="button" className="icon-button" aria-label="إزالة" onClick={() => setMcItems((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="os-mc-foot">
              <button type="button" className="button small ghost" onClick={() => setMcItems((cur) => [...cur, { name: `بند ${cur.length + 1}`, optimistic: 1, likely: 2, pessimistic: 4 }])}><Plus size={14} aria-hidden="true" /> بند</button>
              <label className="os-inline-field">المحاكايات<input type="number" min={100} max={100000} step={500} value={trials} onChange={(e) => setTrials(Math.min(100000, Math.max(100, Number(e.target.value) || 1000)))} /></label>
              <label className="os-inline-field">البذرة<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
            </div>
          </div>
          {mcResult && (
            <div className="os-result panel panel-pad">
              <div className="os-stat-cards">
                {[['المتوسط', mcResult.mean], ['p10', mcResult.p10], ['p50 (الوسيط)', mcResult.p50], ['p90', mcResult.p90], ['الانحراف', mcResult.stddev], ['المحاكايات', mcResult.trials]].map(([label, value]) => (
                  <div key={String(label)} className="os-stat"><small>{label}</small><strong>{typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value}</strong></div>
                ))}
              </div>
              <div className="os-histogram" role="img" aria-label="توزيع النتائج">
                {mcResult.histogram.map((bucket, index) => (
                  <div key={index} className="os-hist-bar" title={`${bucket.from.toFixed(1)}–${bucket.to.toFixed(1)}: ${bucket.count}`}>
                    <span style={{ height: `${(bucket.count / histogramMax) * 100}%` }} />
                  </div>
                ))}
              </div>
              <p className="subtle os-disclaimer">{mcResult.disclaimer}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'decision' && (
        <div className="os-decision">
          <div className="os-schedule-head">
            <div>
              <h2>مصفوفة قرار موزونة مع اختبار متانة</h2>
              <p className="subtle">درجة 0–10 لكل بديل × وزن المعيار. بعد الترتيب، نجرّب إزاحة كل وزن ±25% ونبلغ إذا انقلب الفائز — لا توصية أعمى.</p>
            </div>
            <button type="button" className="button primary" disabled={decisionBusy} onClick={() => void runDecision()}>{decisionBusy ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} احسب</button>
          </div>
          <div className="os-decision-grid">
            <div className="os-table-wrap panel">
              <h3>المعايير والأوزان</h3>
              <table className="os-table">
                <thead><tr><th>المعيار</th><th>الوزن</th><th></th></tr></thead>
                <tbody>{criteria.map((c, i) => (
                  <tr key={c.id}>
                    <td><input dir="auto" value={c.label} onChange={(e) => setCriteria((cur) => cur.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} aria-label="المعيار" /></td>
                    <td><input className="os-cost-input" type="number" min={0.1} step={0.5} value={c.weight} onChange={(e) => setCriteria((cur) => cur.map((x, j) => j === i ? { ...x, weight: Math.max(0.1, Number(e.target.value) || 1) } : x))} aria-label="الوزن" /></td>
                    <td><button type="button" className="icon-button" aria-label="إزالة" onClick={() => setCriteria((cur) => cur.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
              <button type="button" className="button small ghost" onClick={() => setCriteria((cur) => [...cur, { id: `c${Date.now()}`, label: `معيار ${cur.length + 1}`, weight: 3 }])}><Plus size={14} aria-hidden="true" /> معيار</button>
            </div>
            <div className="os-table-wrap panel">
              <h3>البدائل والدرجات (0–10)</h3>
              <table className="os-table">
                <thead><tr><th>البديل</th>{criteria.map((c) => <th key={c.id} dir="auto">{c.label}</th>)}<th></th></tr></thead>
                <tbody>{alternatives.map((alt, i) => (
                  <tr key={i}>
                    <td><input dir="auto" value={alt.name} onChange={(e) => setAlternatives((cur) => cur.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="البديل" /></td>
                    {criteria.map((c) => (
                      <td key={c.id}><input className="os-cost-input" type="number" min={0} max={10} step={0.5} value={alt.scores[c.id] ?? 0} onChange={(e) => setAlternatives((cur) => cur.map((x, j) => j === i ? { ...x, scores: { ...x.scores, [c.id]: Math.min(10, Math.max(0, Number(e.target.value) || 0)) } } : x))} aria-label={`${alt.name} — ${c.label}`} /></td>
                    ))}
                    <td><button type="button" className="icon-button" aria-label="إزالة" onClick={() => setAlternatives((cur) => cur.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
              <button type="button" className="button small ghost" onClick={() => setAlternatives((cur) => [...cur, { name: `بديل ${cur.length + 1}`, scores: Object.fromEntries(criteria.map((c) => [c.id, 5])) }])}><Plus size={14} aria-hidden="true" /> بديل</button>
            </div>
          </div>
          {decisionResult && (
            <div className="os-result panel panel-pad">
              <div className="os-result-head">
                <CheckCircle2 size={18} className="os-ok" aria-hidden="true" />
                <h3>الفائز: <span dir="auto">{decisionResult.winner}</span> {decisionResult.robust ? <span className="os-ok">(متين تحت إزاحة ±25%)</span> : <span className="os-bad">(حساس لأوزان المعايير)</span>}</h3>
              </div>
              <ol className="os-ranking">{decisionResult.ranking.map((entry, i) => (
                <li key={entry.name} className={i === 0 ? 'is-winner' : ''}><span dir="auto">{entry.name}</span><strong>{entry.score.toFixed(3)}</strong></li>
              ))}</ol>
              {decisionResult.perturbationNotes.length > 0 && <ul className="os-validation">{decisionResult.perturbationNotes.map((n) => <li key={n}><ShieldAlert size={12} aria-hidden="true" />{n}</li>)}</ul>}
              <p className="subtle os-disclaimer">{decisionResult.methodology}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'twins' && (
        <div className="os-twins">
          <div className="os-schedule-head">
            <div>
              <h2>التوأم الرقمي — نموذج حي للكيان التشغيلي</h2>
              <p className="subtle">عرّف كيانًا تشغيليًا حقيقيًا (متجر، مستودع، خط إنتاج…) بمحركات PERT ثلاثية النقاط وسجل ملاحظات فعلية. سيناريوهات «ماذا لو» تُعيد تشغيل مونتي كارلو المُبذورة — النتائج محاكاة موسومة، وليست قياسًا لأنظمة حية.</p>
            </div>
          </div>

          <div className="os-decision-grid">
            <div className="os-table-wrap panel">
              <h3>إنشاء توأم جديد</h3>
              <label className="label">الاسم<input dir="auto" className="field" value={twinName} onChange={(e) => setTwinName(e.target.value)} placeholder="مثال: فرع المعادي" maxLength={120} /></label>
              <label className="label">نوع الكيان
                <select className="field" value={twinEntityType} onChange={(e) => setTwinEntityType(e.target.value)}>
                  <option value="operation">عملية تشغيلية</option>
                  <option value="store">متجر</option>
                  <option value="warehouse">مستودع</option>
                  <option value="pipeline">خط إنتاج</option>
                  <option value="service">خدمة</option>
                  <option value="custom">مخصص</option>
                </select>
              </label>
              <h4>المحركات (متفائل / محتمل / متشائم)</h4>
              {twinDrivers.map((driver, index) => (
                <div className="os-twin-driver" key={index}>
                  <input dir="auto" className="field" value={driver.name} onChange={(e) => setTwinDrivers((cur) => cur.map((d, i) => i === index ? { ...d, name: e.target.value } : d))} aria-label="اسم المحرك" />
                  {(['optimistic', 'likely', 'pessimistic'] as const).map((key) => (
                    <input key={key} className="os-cost-input" type="number" step={0.5} value={driver[key]} onChange={(e) => setTwinDrivers((cur) => cur.map((d, i) => i === index ? { ...d, [key]: Number(e.target.value) || 0 } : d))} aria-label={key} />
                  ))}
                  <button type="button" className="icon-button" aria-label="إزالة المحرك" onClick={() => setTwinDrivers((cur) => cur.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className="button small ghost" onClick={() => setTwinDrivers((cur) => [...cur, { name: `محرك ${cur.length + 1}`, optimistic: 1, likely: 2, pessimistic: 4 }])}><Plus size={14} aria-hidden="true" /> محرك</button>
              <button type="button" className="button primary" disabled={twinBusy} onClick={() => void createTwin()}>{twinBusy ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} أنشئ التوأم</button>
            </div>

            <div className="os-table-wrap panel">
              <h3>التوائم ({twins?.length ?? 0})</h3>
              {twins === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
              <div className="os-twin-list">
                {twins?.map((twin) => (
                  <button key={twin.id} type="button" className={`os-twin-item${twin.id === selectedTwinId ? ' is-active' : ''}`} onClick={() => { setSelectedTwinId(twin.id); setScenarioResult(null); setScenarioAdjustments({}); }}>
                    <strong dir="auto">{twin.name}</strong>
                    <small>{twin.entityType} · {twin.params.drivers.length} محركات · {twin.events.length} أحداث</small>
                  </button>
                ))}
                {twins?.length === 0 && <div className="os-empty"><Boxes size={22} aria-hidden="true" /><p>لا توجد توائم بعد — أنشئ أول توأم من النموذج.</p></div>}
              </div>
            </div>
          </div>

          {selectedTwin && (
            <div className="os-result panel panel-pad">
              <div className="os-result-head">
                <Boxes size={18} className="os-ok" aria-hidden="true" />
                <h3 dir="auto">{selectedTwin.name} — اختبار «ماذا لو»</h3>
                <button type="button" className="button ghost small danger" onClick={() => { void osApi.deleteTwin(selectedTwin.id).then(() => { setSelectedTwinId(null); setScenarioResult(null); void refreshTwins(); }); }}><Trash2 size={13} aria-hidden="true" /> حذف التوأم</button>
              </div>

              <div className="os-twin-scenario-grid">
                <div>
                  <h4>ملاحظة فعلية (تُسجَّل في سجل التوأم)</h4>
                  <div className="os-mc-foot">
                    <input dir="auto" className="field" value={observationText} onChange={(e) => setObservationText(e.target.value)} placeholder="مثال: الإنتاج الفعلي اليوم 118 قطعة" maxLength={500} aria-label="الملاحظة" />
                    <button type="button" className="button small primary" disabled={twinBusy || !observationText.trim()} onClick={() => void recordObservation()}>سجّل</button>
                  </div>
                  <h4>السيناريو</h4>
                  <label className="label">اسم السيناريو<input dir="auto" className="field" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} maxLength={120} /></label>
                  <table className="os-table">
                    <thead><tr><th>المحرك</th><th>العملية</th><th>القيمة</th></tr></thead>
                    <tbody>{selectedTwin.params.drivers.map((driver) => {
                      const adj = scenarioAdjustments[driver.name];
                      return (
                        <tr key={driver.name}>
                          <td dir="auto">{driver.name}</td>
                          <td>
                            <select className="field" value={adj?.op ?? 'none'} onChange={(e) => setScenarioAdjustments((cur) => {
                              const next = { ...cur };
                              if (e.target.value === 'none') delete next[driver.name];
                              else next[driver.name] = { op: e.target.value as 'mul' | 'add', value: next[driver.name]?.value ?? 1 };
                              return next;
                            })} aria-label={`عملية ${driver.name}`}>
                              <option value="none">بدون تغيير</option>
                              <option value="mul">× (ضرب)</option>
                              <option value="add">+ (جمع)</option>
                            </select>
                          </td>
                          <td><input className="os-cost-input" type="number" step={0.1} value={adj?.value ?? 1} disabled={!adj} onChange={(e) => setScenarioAdjustments((cur) => adj ? { ...cur, [driver.name]: { ...adj, value: Number(e.target.value) || 0 } } : cur)} aria-label={`قيمة ${driver.name}`} /></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  <button type="button" className="button primary" disabled={scenarioBusy} onClick={() => void runScenario()}>{scenarioBusy ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} شغّل السيناريو (5000 محاكاة)</button>
                </div>
                <div>
                  <h4>آخر الأحداث</h4>
                  <ul className="os-validation">{[...selectedTwin.events].slice(-6).reverse().map((event) => <li key={event.id}><CheckCircle2 size={12} aria-hidden="true" /><span dir="auto">{event.type === 'scenario' ? `سيناريو: ${String(event.payload['name'] ?? '')} — p50 ${String((event.payload as { scenario?: { p50?: number } })['scenario']?.p50 ?? '—')}` : String(event.payload['note'] ?? JSON.stringify(event.payload)).slice(0, 140)}</span></li>)}</ul>
                  {scenarioResult && (
                    <>
                      <h4>النتيجة (محاكاة، وليست قياسًا)</h4>
                      <div className="os-stat-cards">
                        {([
                          ['p50 أساسي', scenarioResult.baseline.p50],
                          ['p50 السيناريو', scenarioResult.scenario.p50],
                          ['Δp50', scenarioResult.deltaP50],
                          ['Δp90', scenarioResult.deltaP90],
                          ['Δ المتوسط %', scenarioResult.deltaMeanPct],
                        ] as Array<[string, number]>).map(([label, value]) => (
                          <div key={label} className="os-stat"><small>{label}</small><strong>{Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong></div>
                        ))}
                      </div>
                      <p className="subtle os-disclaimer">محاكاة مُبذورة (seed {scenarioResult.seed}، {scenarioResult.trials} محاكاة) من مدخلات PERT — ليست وعدًا بالأداء الفعلي.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'playbooks' && (
        <div className="os-playbooks">
          <p className="subtle os-playbooks-intro">WORA يبني هذه الوصفات بنفسه: بعد كل مهمة عمليات بحوث تكتمل بنجاح، يُعيد تشغيل المُحلِّ على نفس البيانات — لا تثق إلا بما أُعيد التحقق منه — ويحفظها كـ «playbook» يعيد استعمالها ويُعزز عداد نجاحه مع كل مهمة مشابهة.</p>
          {playbooks === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
          <div className="os-tool-grid">
            {playbooks?.map((playbook) => (
              <article key={playbook.id} className="os-tool-card panel">
                <div className="os-tool-head"><code>{playbook.toolId}</code><span className="os-risk os-risk-low">validated</span></div>
                <h3 dir="auto">{playbook.name}</h3>
                <p className="subtle">{playbook.validation.detail}</p>
                <small className="subtle">{playbook.successRuns} تشغيل ناجح · {playbook.reuseCount ?? 0} إعادة استعمال من المخطط · آخر تحديث {new Date(playbook.updatedAt).toLocaleDateString('ar')}</small>
                <button type="button" className="button ghost small danger" onClick={() => { void osApi.deletePlaybook(playbook.id).then(() => setPlaybooks((current) => current?.filter((item) => item.id !== playbook.id) ?? null)); }} aria-label="حذف الـ playbook"><Trash2 size={13} aria-hidden="true" /> حذف</button>
              </article>
            ))}
          </div>
          {playbooks?.length === 0 && <div className="os-empty"><CheckCircle2 size={24} aria-hidden="true" /><p>لا توجد playbooks بعد — أكمل مهمة جدولة/تحسين من مركز التنفيذ، وستظهر هنا بعد أن يعيد WORA التحقق منها.</p></div>}
        </div>
      )}

      {tab === 'lessons' && (
        <div className="os-lessons">
          <div className="os-schedule-head">
            <div>
              <h2>دروس من تجارب متحقق منها — بلا ترقية تلقائية</h2>
              <p className="subtle">الدرس يبدأ مرشحًا، ثم يُقيَّم مقابل سجل تحقق مستقل، ثم يرقّيه مشرف صراحةً إلى ذاكرة دلالية. السحب يحذف الذاكرة ويحفظ السجل. الفاعلية تُحسب من نتائج حقيقية فقط.</p>
            </div>
            <div className="os-schedule-actions">
              <select value={lessonStatus} onChange={(event) => { const next = event.target.value as Lesson['status'] | 'all'; setLessonStatus(next); void loadLessons(next); }} aria-label="تصفية الدروس">
                {['all', 'candidate', 'tested', 'promoted', 'rejected', 'revoked'].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button type="button" className="button ghost small" onClick={() => void loadLessons(lessonStatus)} disabled={lessonBusy}>تحديث</button>
            </div>
          </div>
          {lessons === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
          {lessons?.length === 0 && <div className="os-empty"><GraduationCap size={24} aria-hidden="true" /><p>لا توجد دروس بهذه الحالة. تُجمع الدروس المرشحة بعد مهام مكتملة بتحقق مستقل.</p></div>}
          <div className="os-tool-grid">
            {lessons?.map((lesson) => (
              <article key={lesson.id} className="panel panel-pad">
                <div className="os-memory-item-head"><span className="os-spec-chip">{lesson.status}</span><small className="subtle">v{lesson.version} · ثقة {Math.round(lesson.confidence * 100)}%</small></div>
                <h3 dir="auto">{lesson.title}</h3>
                <p dir="auto" className="subtle">{lesson.content.slice(0, 320)}</p>
                <p className="subtle">الفاعلية: {lesson.outcomeCount ? `${Math.round(lesson.effectiveness * 100)}% من ${lesson.outcomeCount} نتيجة` : 'لا نتائج بعد'} · المصدر: {lesson.provenance}</p>
                <div className="os-approval-actions">
                  {lesson.status === 'candidate' && <button type="button" className="button small" disabled={lessonBusy} onClick={() => void lessonAction(lesson.id, 'evaluate')}>تقييم</button>}
                  {lesson.status === 'tested' && <button type="button" className="button primary small" disabled={lessonBusy} onClick={() => void lessonAction(lesson.id, 'promote')}>ترقية</button>}
                  {(lesson.status === 'candidate' || lesson.status === 'tested') && <button type="button" className="button ghost small danger" disabled={lessonBusy} onClick={() => void lessonAction(lesson.id, 'reject')}>رفض</button>}
                  {lesson.status === 'promoted' && <button type="button" className="button ghost small danger" disabled={lessonBusy} onClick={() => void lessonAction(lesson.id, 'revoke')}>سحب</button>}
                  {lesson.status === 'promoted' && <button type="button" className="button ghost small" disabled={lessonBusy} onClick={() => void lessonAction(lesson.id, 'success')}>نتيجة ناجحة</button>}
                  {lesson.status === 'promoted' && <button type="button" className="button ghost small danger" disabled={lessonBusy} onClick={() => void lessonAction(lesson.id, 'failure')}>نتيجة فاشلة</button>}
                  <button type="button" className="button ghost small" onClick={() => void toggleLessonHistory(lesson.id)}>السجل</button>
                </div>
                {lessonHistory[lesson.id] && <ul className="os-memory-versions">{lessonHistory[lesson.id]!.map((event) => <li key={event.id}><code>{event.action}</code> · {event.actor} · {new Date(event.createdAt).toLocaleString('ar')}</li>)}</ul>}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'benchmarks' && (
        <div className="os-benchmarks">
          <div className="os-schedule-head">
            <div>
              <h2>مقاييس علمية قابلة للتكرار</h2>
              <p className="subtle">مقارنات على بيانات ثابتة وأدوات حقيقية. النتائج تقيس الصحة والزمن؛ لا تدّعي تحسينًا غير مقاس. القيود مذكورة مع كل بند.</p>
            </div>
            <button type="button" className="button primary" onClick={() => void runBenchmarks()} disabled={benchmarkBusy}>
              {benchmarkBusy ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} تشغيل المجموعة
            </button>
          </div>
          {benchmarks?.[0] && <p className="subtle">آخر تشغيل: {benchmarks[0].summary.passed}/{benchmarks[0].summary.total} ناجح · {benchmarks[0].summary.totalMs} ms · إصدار {benchmarks[0].suiteVersion}</p>}
          {benchmarks?.length === 0 && <p className="subtle">لا توجد عمليات بعد — شغّل المجموعة.</p>}
          {benchmarks?.[0]?.results.map((result) => (
            <details key={result.id} className="os-handoffs">
              <summary>{result.correctness ? '✓' : '✗'} {result.name} · {result.timeMs} ms · {result.toolCalls} نداء</summary>
              <p className="subtle">المرجع: {result.reference}</p>
              <p className="subtle">البدائل: {result.alternatives.join(' · ')}</p>
              <ul className="os-acceptance">{result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
              <pre className="os-pre">{JSON.stringify(result.evidence, null, 2).slice(0, 3000)}</pre>
            </details>
          ))}
          {benchmarkDomains && (
            <details className="os-handoffs">
              <summary>خريطة القدرات العلمية ({benchmarkDomains.length} مجالًا)</summary>
              <ul className="os-acceptance">
                {benchmarkDomains.map((domain) => <li key={domain.domain}><strong>{domain.domain}</strong>: منفذ {domain.implemented.length} · جزئي {domain.partial.length} · مفقود {domain.missing.length}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === 'tools' && (
        <div className="os-tools">
          <p className="subtle">سجل الأدوات الموحّد — كل وكيل يصل للعالم الخارجي عبر هذه الأدوات فقط، مع صلاحية ومستوى مخاطرة ووقت أقصى.</p>
          {tools === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
          <div className="os-tool-grid">
            {tools?.map((tool) => (
              <article key={tool.id} className="os-tool-card panel">
                <div className="os-tool-head"><code>{tool.id}</code><span className={`os-risk os-risk-${tool.risk}`}>{tool.risk}</span></div>
                <h3>{tool.name}</h3>
                <p className="subtle">{tool.description}</p>
                <small className="subtle">{tool.permission ?? 'بدون صلاحية'} · مهلة {tool.timeoutMs}ms · {tool.environment}</small>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
