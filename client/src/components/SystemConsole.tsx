import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, CircleAlert, Database, History, LoaderCircle, MemoryStick, MonitorSmartphone, Plug2, Search, ServerCog, ShieldCheck, Trash2,
} from 'lucide-react';
import { OsApiError, osApi, type OsState } from '../os/api.js';

type Tab = 'overview' | 'memory' | 'audit';
const SCOPES = ['workspace', 'user', 'project', 'agent', 'organization', 'execution', 'episodic', 'semantic'] as const;

interface MemoryItem { id: string; scope: string; content: string; tags: string[]; provenance: string; createdAt: string }
interface AuditItem { id: string; actor: string; action: string; subject: string; createdAt: string }

const CAPABILITIES: Array<{ name: string; status: 'live' | 'config' | 'missing'; note: string }> = [
  { name: 'مركز التنفيذ — مهام حقيقية بحالة وأدلة ومراجعة', status: 'live', note: 'يعمل الآن عبر /api/os' },
  { name: 'مولّد تطبيقات حقيقي (scaffold + node --test)', status: 'live', note: 'يبني تطبيقًا ويشغّل اختباره كدليل' },
  { name: 'حلّال LP/MIP (HiGHS) + Hungarian + مونتي كارلو', status: 'live', note: 'يعمل محليًا بلا تغذية خارجية' },
  { name: 'سجل الوكلاء والمنظمات الافتراضية', status: 'live', note: '18 تخصصًا مُهيأة + إنشاء مخصص' },
  { name: 'الذاكرة الدائمة (scopes + Provenance + حذف مدقق)', status: 'live', note: 'SQLite عبر data/wora-os.db' },
  { name: 'تدقيق الأحداث (audit log)', status: 'live', note: 'كل عملية أدوات/وكيل/ذاكرة تُسجل' },
  { name: 'الوكيل المحلي للجهاز (Local Device Agent)', status: 'missing', note: 'يتطلب جهازًا مصرحًا واتصالًا حيًا — غير متصل. WORA لا يدّعي فحص جهازك.' },
  { name: 'أتمتة المتصفح الحقيقية (Playwright)', status: 'missing', note: 'البنية جاهزة في سجل الأدوات؛ التنفيذ يتطلب بيئة متصفح مخصصة' },
  { name: 'نماذج سحابية للاستدلال', status: 'config', note: 'تحتاج STUDIO_PROVIDER + مفتاح على الخادم — بلا مفاتيح لا تُرسل بيانات لنماذج' },
  { name: 'PostgreSQL/pgvector بدل SQLite', status: 'config', note: 'طبقة الوصول معزولة في os/db.ts وقابلة للاستبدال' },
];

export function SystemConsole() {
  const [tab, setTab] = useState<Tab>('overview');
  const [state, setState] = useState<OsState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [memQuery, setMemQuery] = useState('');
  const [memContent, setMemContent] = useState('');
  const [memScope, setMemScope] = useState<string>('workspace');
  const [memBusy, setMemBusy] = useState(false);

  const [audit, setAudit] = useState<AuditItem[] | null>(null);

  useEffect(() => {
    osApi.state().then(setState).catch((err) => setError(err instanceof OsApiError ? err.message : 'تعذر قراءة حالة النظام.'));
  }, []);

  const loadMemory = useCallback(async (query = '') => {
    try { setMemories((await osApi.memory(query)) as unknown as MemoryItem[]); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحميل الذاكرة.'); }
  }, []);

  useEffect(() => { if (tab === 'memory') void loadMemory(memQuery); }, [tab, loadMemory, memQuery]);
  useEffect(() => { if (tab === 'audit' && audit === null) osApi.audit(40).then((rows) => setAudit(rows as unknown as AuditItem[])).catch((err) => setError(err instanceof OsApiError ? err.message : 'تعذر تحميل سجل التدقيق.')); }, [tab, audit]);

  async function addMemory(event: React.FormEvent) {
    event.preventDefault();
    if (!memContent.trim() || memBusy) return;
    setMemBusy(true);
    try {
      await osApi.addMemory({ scope: memScope, content: memContent.trim(), tags: [] });
      setMemContent('');
      await loadMemory(memQuery);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر الحفظ.');
    } finally {
      setMemBusy(false);
    }
  }

  async function removeMemory(id: string) {
    try { await osApi.deleteMemory(id); await loadMemory(memQuery); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر الحذف.'); }
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof ServerCog }> = [
    { id: 'overview', label: 'نظرة عامة', icon: ServerCog },
    { id: 'memory', label: 'الذاكرة', icon: Database },
    { id: 'audit', label: 'سجل التدقيق', icon: History },
  ];

  return (
    <div className="os-page">
      <header className="os-page-head">
        <div>
          <h1><ServerCog size={20} aria-hidden="true" /> النظام</h1>
          <p className="subtle">حالة WORA الحقيقية: التنفيذ، الذاكرة، التدقيق — وما هو غير مفعّل بعد ولماذا.</p>
        </div>
        <div className="os-tabs" role="tablist">
          {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`os-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}><t.icon size={14} aria-hidden="true" /> {t.label}</button>)}
        </div>
      </header>

      {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

      {tab === 'overview' && (
        <>
          <div className="os-stat-cards">
            {state === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
            {state && [
              ['وكلاء دائمون', state.agents],
              ['مهمات منجزة', state.missions.completed],
              ['مهمات فاشلة', state.missions.failed],
              ['مهام مكتملة', state.tasks.completed],
              ['عناصر ذاكرة', state.memory],
              ['منظمات', state.organizations],
              ['مشاريع OS', state.projects],
              ['مخرجات', state.artifacts],
            ].map(([label, value]) => (
              <div key={String(label)} className="os-stat"><small>{label}</small><strong>{String(value)}</strong></div>
            ))}
          </div>
          <div className="panel panel-pad">
            <h2 className="os-section-title"><MonitorSmartphone size={16} aria-hidden="true" /> مصفوفة القدرات — بصراحة</h2>
            <ul className="os-capability-list">
              {CAPABILITIES.map((cap) => (
                <li key={cap.name}>
                  {cap.status === 'live' && <CheckCircle2 size={15} className="os-ok" aria-hidden="true" />}
                  {cap.status === 'config' && <Plug2 size={15} className="os-warn-icon" aria-hidden="true" />}
                  {cap.status === 'missing' && <CircleAlert size={15} className="os-bad" aria-hidden="true" />}
                  <span className="os-capability-name" dir="auto">{cap.name}</span>
                  <span className="subtle os-capability-note" dir="auto">{cap.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {tab === 'memory' && (
        <div className="os-memory">
          <form className="panel panel-pad os-memory-add" onSubmit={(e) => void addMemory(e)}>
            <h2><MemoryStick size={15} aria-hidden="true" /> احفظ في ذاكرة WORA</h2>
            <div className="os-memory-row">
              <select value={memScope} onChange={(e) => setMemScope(e.target.value)} aria-label="النطاق">
                {SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
              </select>
              <input dir="auto" maxLength={2000} value={memContent} onChange={(e) => setMemContent(e.target.value)} placeholder="حقيقة أو قرار أو درس مستفاد لتتذكره WORA…" required aria-label="المحتوى" />
              <button type="submit" className="button primary" disabled={memBusy || !memContent.trim()}>{memBusy ? <LoaderCircle size={14} className="os-spin" aria-hidden="true" /> : 'احفظ'}</button>
            </div>
          </form>
          <label className="os-search"><Search size={15} aria-hidden="true" /><input value={memQuery} onChange={(e) => setMemQuery(e.target.value)} placeholder="ابحث في الذاكرة (مصطلحات طبيعية)…" aria-label="بحث في الذاكرة" /></label>
          {memories === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
          <ul className="os-memory-list">
            {memories?.map((memory) => (
              <li key={memory.id} className="os-memory-item panel">
                <div className="os-memory-item-head"><span className="os-spec-chip">{memory.scope}</span><small className="subtle">{new Date(memory.createdAt).toLocaleString('ar')} · {memory.provenance}</small>
                  <button type="button" className="icon-button" aria-label="حذف من الذاكرة" onClick={() => void removeMemory(memory.id)}><Trash2 size={14} /></button>
                </div>
                <p dir="auto">{memory.content}</p>
              </li>
            ))}
            {memories?.length === 0 && <li className="os-empty"><Database size={22} aria-hidden="true" /><p>لا توجد نتائج. احفظ أول حقيقة أعلاه — ستستدعيها الوكلاء عبر memory.search أثناء التنفيذ.</p></li>}
          </ul>
        </div>
      )}

      {tab === 'audit' && (
        <div className="panel">
          {audit === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
          <table className="os-table os-audit-table">
            <thead><tr><th>الوقت</th><th>الفاعل</th><th>الحدث</th><th>الموضوع</th></tr></thead>
            <tbody>
              {audit?.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString('ar')}</td>
                  <td dir="auto">{row.actor}</td>
                  <td><code>{row.action}</code></td>
                  <td dir="auto">{row.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit?.length === 0 && <p className="os-empty"><ShieldCheck size={22} aria-hidden="true" /><p>لا توجد أحداث بعد — ستظهر هنا كل عملية تنفذها WORA.</p></p>}
        </div>
      )}
    </div>
  );
}
