import { useCallback, useEffect, useState } from 'react';
import {
  Bot, Building2, CheckCircle2, CircleAlert, LoaderCircle, Plus, Search, Trash2, Users, Workflow, X,
} from 'lucide-react';
import { OsApiError, osApi, type Agent, type Organization, type OrgBuildResult, type Specialization } from '../os/api.js';

type Tab = 'agents' | 'organizations';

function CreateAgentDialog({ specializations, onClose, onCreated }: { specializations: Specialization[]; onClose: () => void; onCreated: (agent: Agent) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [specialization, setSpecialization] = useState('qa_engineer');
  const [skills, setSkills] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const agent = await osApi.createAgent({
        name: name.trim(),
        role: role.trim(),
        specialization,
        skills: skills.split(/[,،]/).map((s) => s.trim()).filter(Boolean).slice(0, 40),
        instructions: instructions.trim() || undefined,
      });
      onCreated(agent);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر إنشاء الوكيل.');
      setBusy(false);
    }
  }

  return (
    <div className="os-dialog-backdrop" role="dialog" aria-modal="true" aria-label="إنشاء وكيل">
      <form className="os-dialog panel panel-pad" onSubmit={(e) => void submit(e)}>
        <div className="os-dialog-head">
          <h2><Bot size={18} aria-hidden="true" /> إنشاء وكيل دائم</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </div>
        {error && <div className="os-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
        <label className="os-field">الاسم<input required dir="auto" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: وكيل اختبار البرمجيات" /></label>
        <label className="os-field">الدور والمسؤولية<textarea required dir="auto" maxLength={500} rows={2} value={role} onChange={(e) => setRole(e.target.value)} placeholder="ما الذي يتخصص فيه؟ ما معايير نجاحه؟" /></label>
        <label className="os-field">التخصص
          <select value={specialization} onChange={(e) => setSpecialization(e.target.value)}>
            {specializations.map((spec) => <option key={spec.id} value={spec.id}>{spec.label}</option>)}
          </select>
        </label>
        <label className="os-field">المهارات <span className="subtle">(مفصولة بفواصل)</span><input dir="auto" maxLength={600} value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="test-design, api-testing, regression" /></label>
        <label className="os-field">التعليمات <span className="subtle">(اختياري)</span><textarea dir="auto" maxLength={4000} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="قواعد العمل، أسلوب التسليم، ما الذي يجب دائمًا إرفاقه كدليل…" /></label>
        <div className="os-dialog-actions">
          <button type="button" className="button ghost" onClick={onClose}>إلغاء</button>
          <button type="submit" className="button primary" disabled={busy || !name.trim() || !role.trim()}>{busy ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />} إنشاء وحفظ</button>
        </div>
      </form>
    </div>
  );
}

export function AgentRegistry() {
  const [tab, setTab] = useState<Tab>('agents');
  const [specializations, setSpecializations] = useState<Specialization[]>([]);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [query, setQuery] = useState('');
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [orgObjective, setOrgObjective] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgResult, setOrgResult] = useState<OrgBuildResult | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const [specs, list] = await Promise.all([osApi.specializations(), osApi.agents(query)]);
      setSpecializations(specs);
      setAgents(specializationFilter ? list.filter((a) => a.specialization === specializationFilter) : list);
      setError(null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحميل الوكلاء.');
    }
  }, [query, specializationFilter]);

  const loadOrgs = useCallback(async () => {
    try {
      setOrganizations(await osApi.organizations());
      setError(null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحميل المنظمات.');
    }
  }, []);

  useEffect(() => { if (tab === 'agents') void loadAgents(); }, [tab, loadAgents]);
  useEffect(() => { if (tab === 'organizations') void loadOrgs(); }, [tab, loadOrgs]);

  async function toggleStatus(agent: Agent) {
    setBusyId(agent.id);
    try {
      await osApi.updateAgent(agent.id, { status: agent.status === 'active' ? 'paused' : 'active' });
      await loadAgents();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحديث حالة الوكيل.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(agent: Agent) {
    if (!window.confirm(`حذف الوكيل "${agent.name}" نهائيًا؟`)) return;
    setBusyId(agent.id);
    try {
      await osApi.deleteAgent(agent.id);
      await loadAgents();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر حذف الوكيل.');
    } finally {
      setBusyId(null);
    }
  }

  async function buildOrg(event: React.FormEvent) {
    event.preventDefault();
    if (orgBusy || orgObjective.trim().length < 10) return;
    setOrgBusy(true);
    setError(null);
    setOrgResult(null);
    try {
      const result = await osApi.buildOrganization({ objective: orgObjective.trim(), name: orgName.trim() || undefined });
      setOrgResult(result);
      await Promise.all([loadOrgs(), loadAgents()]);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر بناء المنظمة.');
    } finally {
      setOrgBusy(false);
    }
  }

  const specLabel = new Map(specializations.map((s) => [s.id, s.label]));

  return (
    <div className="os-page">
      <header className="os-page-head">
        <div>
          <h1><Users size={20} aria-hidden="true" /> الوكلاء والمنظمات</h1>
          <p className="subtle">وكلاء دائمون حقيقيون (تنفيذيون، ليسوا بطاقات) — أو منظمة افتراضية كاملة تبنى من هدف واحد.</p>
        </div>
        <div className="os-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'agents'} className={`os-tab${tab === 'agents' ? ' is-active' : ''}`} onClick={() => setTab('agents')}>الوكلاء</button>
          <button type="button" role="tab" aria-selected={tab === 'organizations'} className={`os-tab${tab === 'organizations' ? ' is-active' : ''}`} onClick={() => setTab('organizations')}>المنظمات</button>
        </div>
      </header>

      {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

      {tab === 'agents' && <>
        <div className="os-toolbar">
          <label className="os-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الدور…" aria-label="بحث في الوكلاء" /></label>
          <select value={specializationFilter} onChange={(e) => setSpecializationFilter(e.target.value)} aria-label="تصفية حسب التخصص">
            <option value="">كل التخصصات</option>
            {specializations.map((spec) => <option key={spec.id} value={spec.id}>{spec.label}</option>)}
          </select>
          <button type="button" className="button primary" onClick={() => setShowCreate(true)}><Plus size={15} aria-hidden="true" /> إنشاء وكيل</button>
        </div>
        {agents === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
        {agents && <div className="os-agent-grid">
          {agents.map((agent) => (
            <article key={agent.id} className="os-agent-card panel panel-pad">
              <div className="os-agent-head">
                <span className="agent-avatar" aria-hidden="true">{agent.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                <div className="os-agent-id">
                  <h2 dir="auto">{agent.name}</h2>
                  <span className="os-spec-chip">{specLabel.get(agent.specialization) ?? agent.specialization}</span>
                </div>
                <span className={`os-dot os-dot-${agent.status}`} title={agent.status} aria-label={agent.status} />
              </div>
              <p className="os-agent-role" dir="auto">{agent.role}</p>
              <div className="os-skill-chips">
                {agent.skills.slice(0, 6).map((skill) => <span key={skill} className="os-chip small">{skill}</span>)}
                {agent.skills.length > 6 && <span className="subtle">+{agent.skills.length - 6}</span>}
              </div>
              <div className="os-agent-foot">
                <small className="subtle">{agent.tools.length} أداة · {agent.permissions.length} صلاحية · {agent.source === 'seed' ? 'أساسي' : agent.source === 'organization' ? 'منظمة' : agent.source === 'orchestrator' ? 'من مهمة' : 'إنشاء يدوي'}</small>
                <span className="os-agent-actions">
                  <button type="button" className="button small ghost" disabled={busyId === agent.id} onClick={() => void toggleStatus(agent)}>{agent.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>
                  <button type="button" className="icon-button" aria-label="حذف الوكيل" disabled={busyId === agent.id} onClick={() => void remove(agent)}><Trash2 size={15} /></button>
                </span>
              </div>
            </article>
          ))}
          {agents.length === 0 && <p className="os-empty">لا توجد نتائج مطابقة.</p>}
        </div>}
        {showCreate && <CreateAgentDialog specializations={specializations} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void loadAgents(); }} />}
      </>}

      {tab === 'organizations' && <>
        <form className="os-org-builder panel panel-pad" onSubmit={(e) => void buildOrg(e)}>
          <h2><Building2 size={17} aria-hidden="true" /> ابنِ منظمة افتراضية من هدف واحد</h2>
          <p className="subtle">WORA يحدد الأقسام والقيادة والأدوار والوكلاء وعلاقات الإبلاغ ومشروع التسليم ومهمة انطلاق — ثم يبدأ العمل فعليًا ويتتبعه.</p>
          <textarea dir="auto" rows={2} required minLength={10} maxLength={4000} value={orgObjective} onChange={(e) => setOrgObjective(e.target.value)} placeholder="مثال: Build an organization to develop and operate an online marketplace for local services…" aria-label="هدف المنظمة" />
          <div className="os-org-builder-foot">
            <input dir="auto" maxLength={120} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="اسم المنظمة (اختياري)" aria-label="اسم المنظمة" />
            <button type="submit" className="button primary" disabled={orgBusy || orgObjective.trim().length < 10}>{orgBusy ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Workflow size={15} aria-hidden="true" />} ابنِ المنظمة</button>
          </div>
        </form>

        {orgResult && (
          <div className="os-org-result panel panel-pad" role="status">
            <h3><CheckCircle2 size={16} aria-hidden="true" /> تم بناء «{orgResult.name}» <span className="os-spec-chip">{orgResult.template}</span></h3>
            <p className="subtle">{orgResult.agentsCreated} وكيلًا جديدًا · {orgResult.agentsReused} معاد استخدامه · مشروع {orgResult.projectId}</p>
            <div className="os-dept-chips">{orgResult.departments.map((d) => <span key={d.id} className="os-chip">{d.name}</span>)}</div>
            <p className="subtle">مهمة انطلاق نفذت تلقائيًا في «مركز التنفيذ» (id: <span className="mono">{orgResult.kickoffMissionId}</span>).</p>
          </div>
        )}

        {organizations === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
        <div className="os-org-grid">
          {organizations?.map((org) => (
            <article key={org.id} className="os-org-card panel panel-pad">
              <h3 dir="auto">{org.name}</h3>
              <p className="subtle" dir="auto">{org.objective}</p>
              <div className="os-dept-chips">{org.departments.map((d) => <span key={d.id} className="os-chip" title={d.kpis.join(' · ')}>{d.name}</span>)}</div>
              <small className="subtle mono">{org.id} · {org.template}</small>
            </article>
          ))}
          {organizations?.length === 0 && <p className="os-empty">لا توجد منظمات بعد. ابنِ أول منظمة من الأعلى.</p>}
        </div>
      </>}
    </div>
  );
}
