import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, CircleAlert, LoaderCircle, Play, Plus, RefreshCw } from 'lucide-react';
import { OsApiError, osApi, type ResearchProgram, type ResearchProgramStatus } from '../os/api.js';

const STATUS_LABELS: Record<ResearchProgramStatus, string> = {
  draft: 'مسودة', active: 'نشط', paused: 'متوقف مؤقتًا', completed: 'مكتمل', cancelled: 'ملغي',
};

export function ResearchProgramsPanel() {
  const [programs, setPrograms] = useState<ResearchProgram[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('WORA Personal — Autonomous R&D');
  const [objective, setObjective] = useState('Build a reproducible autonomous research and development system covering scientific and engineering research, experiments, model evaluation, and controlled self-improvement.');
  const [streamTitle, setStreamTitle] = useState('');
  const [streamObjective, setStreamObjective] = useState('');
  const [specialization, setSpecialization] = useState('research');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(() => programs.find((program) => program.id === selectedId) ?? programs[0] ?? null, [programs, selectedId]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await osApi.researchPrograms();
      setPrograms(result.programs);
      setSelectedId((current) => current && result.programs.some((p) => p.id === current) ? current : result.programs[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحميل برامج البحث.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createProgram() {
    if (!title.trim() || !objective.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const created = await osApi.createResearchProgram({ title: title.trim(), objective: objective.trim(), successCriteria: [
        'Research claims are traceable to dated evidence and explicit uncertainty.',
        'Experiments are reproducible from recorded inputs, versions, and seeds.',
        'Model and software changes pass independent benchmarks before promotion.',
        'Failed experiments can be rolled back without damaging the stable system.',
      ] });
      setPrograms((current) => [created, ...current]);
      setSelectedId(created.id);
      setNotice('اتعمل برنامج البحث واتحفظ بإصدار 1.');
    } catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر إنشاء البرنامج.'); }
    finally { setBusy(false); }
  }

  async function addWorkstream() {
    if (!selected || !streamTitle.trim() || !streamObjective.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await osApi.addResearchWorkstream(selected.id, selected.version, {
        title: streamTitle.trim(), objective: streamObjective.trim(), specialization: specialization.trim(),
      });
      setPrograms((current) => current.map((item) => item.id === updated.id ? updated : item));
      setStreamTitle(''); setStreamObjective('');
      setNotice('اتضاف مسار العمل واتحفظ إصدار جديد.');
    } catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر إضافة مسار العمل.'); }
    finally { setBusy(false); }
  }

  async function setStatus(status: ResearchProgramStatus) {
    if (!selected || busy || selected.status === status) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await osApi.updateResearchProgram(selected.id, selected.version, { status });
      setPrograms((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice('اتحدثت حالة البرنامج واتحفظ إصدار جديد.');
    } catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحديث الحالة.'); }
    finally { setBusy(false); }
  }

  async function launchWorkstreamMission(workstreamId: string) {
    if (!selected || busy) return;
    const stream = selected.workstreams.find((item) => item.id === workstreamId);
    if (!stream) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const mission = await osApi.launchMission(
        `WORA Personal research workstream: ${stream.title}. Objective: ${stream.objective}. Specialization: ${stream.specialization}. Produce traceable evidence, state assumptions and limitations, and report verifiable deliverables.`,
        'research',
      );
      const latest = await osApi.linkResearchMission(selected.id, workstreamId, selected.version, mission.id);
      setPrograms((current) => current.map((item) => item.id === latest.id ? latest : item));
      setNotice(`اتنشأت مهمة فعلية ${mission.id} واتربطت بمسار البحث.`);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تشغيل مسار البحث.');
    } finally { setBusy(false); }
  }

  return (
    <section className="os-research-programs">
      <div className="os-schedule-head">
        <div>
          <h2><BrainCircuit size={18} aria-hidden="true" /> برامج البحث والتطوير — WORA Personal</h2>
          <p className="subtle">برامج دائمة بإصدارات محفوظة. كل مسار عمل يقدر ينشئ Mission حقيقية من الـ Orchestrator الحالي ويربطها بالبرنامج.</p>
        </div>
        <button type="button" className="button ghost small" onClick={() => void refresh()} disabled={busy}><RefreshCw size={14} aria-hidden="true" /> تحديث</button>
      </div>

      {error && <div role="alert" className="os-alert"><CircleAlert size={15} aria-hidden="true" /> {error}</div>}
      {notice && <p className="subtle" role="status">{notice}</p>}

      <div className="os-decision-grid">
        <div className="os-table-wrap panel panel-pad">
          <h3>إنشاء برنامج بحث</h3>
          <label className="label">اسم البرنامج<input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={4000} /></label>
          <label className="label">الهدف<textarea className="field" rows={5} value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={4000} /></label>
          <button type="button" className="button primary" onClick={() => void createProgram()} disabled={busy || !title.trim() || !objective.trim()}>
            {busy ? <LoaderCircle size={15} className="os-spin" /> : <Plus size={15} />} إنشاء برنامج
          </button>
        </div>

        <div className="os-table-wrap panel panel-pad">
          <h3>برامج البحث ({programs.length})</h3>
          {programs.length === 0 && <div className="os-empty"><BrainCircuit size={22} /><p>لسه مفيش برامج. أنشئ برنامج البحث والتطوير الأساسي.</p></div>}
          <div className="os-tool-grid">
            {programs.map((program) => (
              <button key={program.id} type="button" className={`os-twin-item${selected?.id === program.id ? ' is-active' : ''}`} onClick={() => setSelectedId(program.id)}>
                <strong dir="auto">{program.title}</strong>
                <small>{STATUS_LABELS[program.status]} · v{program.version} · {program.workstreams.length} مسارات</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="os-result panel panel-pad">
          <div className="os-result-head">
            <BrainCircuit size={18} className="os-ok" aria-hidden="true" />
            <h3 dir="auto">{selected.title}</h3>
            <span className="os-spec-chip">v{selected.version}</span>
          </div>
          <p dir="auto">{selected.objective}</p>
          <p className="subtle">الحالة: {STATUS_LABELS[selected.status]} · آخر تحديث: {new Date(selected.updatedAt).toLocaleString('ar-EG')}</p>
          <div className="os-approval-actions">
            {selected.status === 'draft' && <button type="button" className="button small primary" disabled={busy} onClick={() => void setStatus('active')}>تفعيل البرنامج</button>}
            {selected.status === 'active' && <button type="button" className="button small" disabled={busy} onClick={() => void setStatus('paused')}>إيقاف مؤقت</button>}
            {selected.status === 'paused' && <button type="button" className="button small primary" disabled={busy} onClick={() => void setStatus('active')}>استئناف</button>}
            {(selected.status === 'active' || selected.status === 'paused') && <button type="button" className="button small" disabled={busy} onClick={() => void setStatus('completed')}>إنهاء</button>}
          </div>
          <h4>مسارات البحث والتطوير</h4>
          {selected.workstreams.length === 0 && <p className="subtle">مفيش مسارات عمل لسه.</p>}
          <div className="os-tool-grid">
            {selected.workstreams.map((stream) => (
              <article className="os-tool-card panel" key={stream.id}>
                <div className="os-tool-head"><code>{stream.specialization}</code><span className="os-risk os-risk-low">{stream.status}</span></div>
                <h3 dir="auto">{stream.title}</h3>
                <p dir="auto" className="subtle">{stream.objective}</p>
                <small className="subtle">{stream.missionIds.length} Missions مرتبطة · {stream.deliverables.length} مخرجات محددة</small>
                <button type="button" className="button small primary" disabled={busy || selected.status === 'completed' || selected.status === 'cancelled'} onClick={() => void launchWorkstreamMission(stream.id)}>
                  {busy ? <LoaderCircle size={14} className="os-spin" /> : <Play size={14} />} إنشاء Mission وتشغيلها
                </button>
              </article>
            ))}
          </div>
          <div className="os-table-wrap panel panel-pad">
            <h4>إضافة مسار عمل</h4>
            <label className="label">العنوان<input className="field" value={streamTitle} onChange={(event) => setStreamTitle(event.target.value)} maxLength={4000} placeholder="مثال: Research Acquisition & Evidence" /></label>
            <label className="label">الهدف<textarea className="field" rows={3} value={streamObjective} onChange={(event) => setStreamObjective(event.target.value)} maxLength={4000} /></label>
            <label className="label">التخصص<input className="field" value={specialization} onChange={(event) => setSpecialization(event.target.value)} maxLength={120} /></label>
            <button type="button" className="button primary" disabled={busy || !streamTitle.trim() || !streamObjective.trim() || selected.status === 'completed' || selected.status === 'cancelled'} onClick={() => void addWorkstream()}>
              {busy ? <LoaderCircle size={15} className="os-spin" /> : <Plus size={15} />} إضافة مسار
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
