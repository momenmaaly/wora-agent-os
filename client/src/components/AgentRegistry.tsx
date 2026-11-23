import { useCallback, useEffect, useState } from 'react';
import {
  Bot, CircleAlert, LoaderCircle, Plus, Search, Trash2, Users, X,
} from 'lucide-react';
import { OsApiError, osApi, type Agent, type Specialization } from '../os/api.js';

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
  const [specializations, setSpecializations] = useState<Specialization[]>([]);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [query, setQuery] = useState('');
  const [specializationFilter, setSpecializationFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  useEffect(() => { void loadAgents(); }, [loadAgents]);

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

  const specLabel = new Map(specializations.map((s) => [s.id, s.label]));

  return (
    <div className="os-page">
      <header className="os-page-head">
        <div>
          <h1><Users size={20} aria-hidden="true" /> الوكلاء</h1>
          <p className="subtle">وكلاء دائمون حقيقيون — تنفيذيون، ليسوا بطاقات عرض. للمنظمات الكاملة: صفحة «المنظمات».</p>
        </div>
      </header>

      {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

      <>
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
      </>
    </div>
  );
}
