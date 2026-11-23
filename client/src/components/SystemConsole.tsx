import { useCallback, useEffect, useState } from 'react';
import {
  Check, CheckCircle2, CircleAlert, Database, History, LoaderCircle, MemoryStick, MonitorSmartphone, Plug2, Search, ServerCog, ShieldCheck, Trash2, Copy, Laptop, X,
} from 'lucide-react';
import { OsApiError, osApi, type ApprovalRecord, type DeviceRecord, type OsState } from '../os/api.js';

type Tab = 'overview' | 'memory' | 'audit' | 'governance';
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
  { name: 'الموافقات البشرية للأدوات عالية الخطورة (balanced افتراضيًا)', status: 'live', note: 'التوقيع على الحمولة الدقيقة → استئناف المهمة تلقائيًا' },
  { name: 'اتصالات أجهزة قابلة للإلغاء (اقتران برمز لمرة واحدة)', status: 'live', note: 'البنية التحتية جاهزة ومدققة؛ الوكيل المحلي نفسه غير مُرفق بعد' },
  { name: 'الوكيل المحلي للجهاز (Local Device Agent)', status: 'missing', note: 'البيناي غير مُرفق — WORA لا يدّعي فحص جهازك. الاقتران/الإلغاء يعملان فعلًا.' },
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

  const [policy, setPolicy] = useState<'balanced' | 'autopilot' | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRecord[] | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[] | null>(null);
  const [pairName, setPairName] = useState('');
  const [pairPlatform, setPairPlatform] = useState('linux');
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [govBusy, setGovBusy] = useState(false);

  useEffect(() => {
    osApi.state().then(setState).catch((err) => setError(err instanceof OsApiError ? err.message : 'تعذر قراءة حالة النظام.'));
  }, []);

  const loadMemory = useCallback(async (query = '') => {
    try { setMemories((await osApi.memory(query)) as unknown as MemoryItem[]); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحميل الذاكرة.'); }
  }, []);

  useEffect(() => { if (tab === 'memory') void loadMemory(memQuery); }, [tab, loadMemory, memQuery]);
  useEffect(() => { if (tab === 'audit' && audit === null) osApi.audit(40).then((rows) => setAudit(rows as unknown as AuditItem[])).catch((err) => setError(err instanceof OsApiError ? err.message : 'تعذر تحميل سجل التدقيق.')); }, [tab, audit]);

  const loadGovernance = useCallback(async () => {
    try {
      const [autonomy, pending, deviceList] = await Promise.all([osApi.autonomy(), osApi.approvals('pending'), osApi.devices()]);
      setPolicy(autonomy.policy);
      setApprovals(pending);
      setDevices(deviceList);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر تحميل الحوكمة.');
    }
  }, []);
  useEffect(() => { if (tab === 'governance' && policy === null) void loadGovernance(); }, [tab, policy, loadGovernance]);

  async function changePolicy(next: 'balanced' | 'autopilot') {
    setGovBusy(true);
    try { const result = await osApi.setAutonomy(next); setPolicy(result.policy); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تغيير سياسة الاستقلالية.'); }
    finally { setGovBusy(false); }
  }

  async function decideApproval(id: string, decision: 'approved' | 'denied') {
    try { await osApi.decideApproval(id, decision); await loadGovernance(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تسجيل القرار.'); }
  }

  async function requestPairing(event: React.FormEvent) {
    event.preventDefault();
    if (!pairName.trim() || govBusy) return;
    setGovBusy(true);
    setPairCode(null);
    try {
      const result = await osApi.pairDevice({ name: pairName.trim(), platform: pairPlatform });
      setPairCode(result.pairingCode);
      setPairName('');
      await loadGovernance();
    } catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر إنشاء طلب الاقتران.'); }
    finally { setGovBusy(false); }
  }

  async function revokeDevice(id: string) {
    try { await osApi.revokeDevice(id); await loadGovernance(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر الإلغاء.'); }
  }

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
    { id: 'governance', label: 'الحوكمة والأجهزة', icon: ShieldCheck },
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
              ['بانتظار موافقة', state.missions.awaitingApproval],
              ['مهمات منجزة', state.missions.completed],
              ['مهمات فاشلة', state.missions.failed],
              ['مهام مكتملة', state.tasks.completed],
              ['موافقات معلقة', state.approvals.pending],
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

      {tab === 'governance' && (
        <div className="os-governance">
          <div className="panel panel-pad">
            <h2 className="os-section-title"><ShieldCheck size={16} aria-hidden="true" /> سياسة الاستقلالية</h2>
            <div className="os-policy-grid" role="radiogroup" aria-label="سياسة الاستقلالية">
              {([
                { id: 'balanced', title: 'متزنة (الافتراضي)', body: 'الوكلاء ينفذون الأدوات منخفضة ومتوسطة الخطورة تلقائيًا. أي تنفيذ عالي الخطورة (مثل host.exec) يتوقف عندك لتقرر على الحمولة الدقيقة.' },
                { id: 'autopilot', title: 'قيادة ذاتية (صريحة)', body: 'تمنح الوكلاء تنفيذ الأدوات عالية الخطورة دون توقف. لا يُنصح بها على بيئة تتصل فيها ببيانات إنتاج.' },
              ] as const).map((option) => (
                <label key={option.id} className={`os-policy-card${policy === option.id ? ' is-active' : ''}`}>
                  <input type="radio" name="autonomy" value={option.id} checked={policy === option.id} disabled={govBusy || policy === null} onChange={() => void changePolicy(option.id)} />
                  <strong>{option.title}</strong>
                  <span className="subtle">{option.body}</span>
                </label>
              ))}
            </div>
            <p className="subtle os-policy-note">الأدوات منخفضة/متوسطة الخطورة مستقلة دائمًا. الإعداد يحفظ لل workspace ويُسجل في سجل التدقيق.</p>
          </div>

          <div className="panel panel-pad">
            <h2 className="os-section-title"><CircleAlert size={16} aria-hidden="true" /> موافقات معلقة {approvals && approvals.length > 0 ? `(${approvals.length})` : ''}</h2>
            {approvals === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
            {approvals?.length === 0 && <p className="subtle">لا توجد موافقات معلقة — كل التنفيذات عالية الخطورة مرت بعينك أو لم تُطلب بعد.</p>}
            <ul className="os-approval-list">
              {approvals?.map((approval) => (
                <li key={approval.id} className="os-approval compact">
                  <div className="os-approval-head">
                    <ShieldCheck size={14} aria-hidden="true" />
                    <strong dir="auto">{approval.actionSummary}</strong>
                  </div>
                  <div className="os-approval-actions">
                    <button type="button" className="button primary small" onClick={() => void decideApproval(approval.id, 'approved')}><Check size={13} aria-hidden="true" /> وافق</button>
                    <button type="button" className="button ghost small danger" onClick={() => void decideApproval(approval.id, 'denied')}><X size={13} aria-hidden="true" /> ارفض</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel panel-pad">
            <h2 className="os-section-title"><Laptop size={16} aria-hidden="true" /> الأجهزة الموثوقة</h2>
            <p className="subtle">اتصال جهازك بنظافة: طلب اقتران ← رمز لمرة واحدة ← وكيل محلي يتفادى بالرمز من جهازك. لا يوجد وكيل محلي مُرفق بعد، ولن يُدّعى فحصه لجهازك حتى يقترن فعلًا. الاتصال قابل للإلغاء في أي لحظة ويُسجل في التدقيق.</p>
            <form className="os-memory-row" onSubmit={(e) => void requestPairing(e)}>
              <input dir="auto" value={pairName} onChange={(e) => setPairName(e.target.value)} placeholder="اسم الجهاز (مثال: MacBook الخاص بي)" maxLength={80} required aria-label="اسم الجهاز" />
              <select value={pairPlatform} onChange={(e) => setPairPlatform(e.target.value)} aria-label="المنصة">
                {['linux', 'macos', 'windows', 'android', 'ios'].map((platform) => <option key={platform} value={platform}>{platform}</option>)}
              </select>
              <button type="submit" className="button primary" disabled={govBusy || !pairName.trim()}>{govBusy ? 'جارٍ الإنشاء…' : 'طلب اقتران'}</button>
            </form>
            {pairCode && (
              <div className="os-pair-code" role="status">
                <span>رمز الاقتران (يُعرض مرة واحدة):</span>
                <code dir="ltr">{pairCode}</code>
                <button type="button" className="icon-button" aria-label="نسخ الرمز" onClick={() => void navigator.clipboard.writeText(pairCode)}><Copy size={15} /></button>
              </div>
            )}
            {devices === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> جارٍ التحميل…</p>}
            <ul className="os-device-list">
              {devices?.map((device) => (
                <li key={device.id} className="os-device">
                  <Laptop size={16} aria-hidden="true" />
                  <span dir="auto"><strong>{device.name}</strong><small className="subtle"> · {device.platform}</small></span>
                  <span className={`os-pill os-pill-device-${device.status}`}>{device.status === 'pending' ? 'بانتظار الوكيل' : device.status === 'paired' ? 'مقترن' : 'ملغى'}</span>
                  {device.status !== 'revoked' && <button type="button" className="button ghost small danger" onClick={() => void revokeDevice(device.id)}>إلغاء</button>}
                </li>
              ))}
              {devices?.length === 0 && <li className="subtle">لا توجد أجهزة — WORA لم يلمس جهازك. اطلب اقترانًا عندما يصبح الوكيل المحلي متاحًا.</li>}
            </ul>
          </div>
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
