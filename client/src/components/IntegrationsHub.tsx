import { useState } from 'react';
import { Check, Github, Link2, Plug2, RefreshCw, Search, Unplug } from 'lucide-react';
import { INTEGRATIONS, type IntegrationDef } from '../integrations/catalog.js';
import { useIntegrationsStore } from '../store/useIntegrationsStore.js';
import { OFFICE_ROOMS } from '../office/layout.js';
import { ROOM_DISPLAY } from '../office/presentation.js';
import { EmptyState, Notice, PageHeader } from './ui.js';

const CATEGORIES: Array<{ id: IntegrationDef['category'] | 'all'; label: string }> = [
  { id: 'all', label: 'الكل' }, { id: 'code', label: 'البرمجة' }, { id: 'design', label: 'التصميم' }, { id: 'plan', label: 'التخطيط' },
  { id: 'marketing', label: 'التسويق' }, { id: 'sales', label: 'المبيعات' }, { id: 'data', label: 'البيانات' }, { id: 'ops', label: 'التواصل' },
];
const dateFormat = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });

export function IntegrationsHub() {
  const connections = useIntegrationsStore((s) => s.connections);
  const connect = useIntegrationsStore((s) => s.connect);
  const disconnect = useIntegrationsStore((s) => s.disconnect);
  const sync = useIntegrationsStore((s) => s.sync);
  const [category, setCategory] = useState<IntegrationDef['category'] | 'all'>('all');
  const [room, setRoom] = useState('all');
  const [query, setQuery] = useState('');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [feedback, setFeedback] = useState('');
  const filtered = INTEGRATIONS.filter((item) => (category === 'all' || item.category === category) && (room === 'all' || item.departments.includes(room)) && (!connectedOnly || !!connections[item.id]) && `${item.nameAr} ${item.nameEn} ${item.descAr}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <PageHeader icon={Plug2} eyebrow="الإدارة" title="التكاملات" description="استكشف الأدوات المناسبة لكل قسم وجرّب إدارة الربط من مكان واحد."
        action={<span className="badge tint tone-mint"><span className="status-dot" />{Object.keys(connections).length} ربط تجريبي</span>} />
      <Notice><strong>وضع تجربة التكاملات.</strong> الربط والمزامنة هنا محاكاة محلية. لا يتم الاتصال بحساباتك أو إرسال بيانات إلى أي خدمة.</Notice>
      <section className="panel panel-pad integration-toolbar">
        <div className="catalog-toolbar">
          <label className="catalog-search"><Search size={18} /><input type="search" className="field" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="البحث عن تكامل" placeholder="ابحث عن أداة مثل GitHub أو Figma..." /></label>
          <select className="field" aria-label="تصفية حسب القسم" value={room} onChange={(event) => setRoom(event.target.value)}><option value="all">كل الأقسام</option>{OFFICE_ROOMS.map((zone) => <option key={zone.id} value={zone.id}>{zone.nameAr}</option>)}</select>
          <button type="button" className="filter-chip" aria-pressed={connectedOnly} onClick={() => setConnectedOnly(!connectedOnly)}><Link2 size={15} />المربوطة فقط</button>
        </div>
        <div className="filter-row" aria-label="فئات التكاملات">{CATEGORIES.map((item) => <button type="button" className="filter-chip" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
      </section>
      <div className="catalog-count" role="status">{feedback || `${filtered.length} أداة`}</div>
      {filtered.length ? <div className="catalog-grid">{filtered.map((item) => {
        const connection = connections[item.id];
        return <article key={item.id} className="panel catalog-card">
          <div className="catalog-head">
            <span className="catalog-symbol integration-symbol" aria-hidden="true" style={{ color: item.color, backgroundColor: item.bg }}>{item.id === 'github' ? <Github size={20} /> : item.icon}</span>
            <div><h2><bdi>{item.nameAr}</bdi></h2><p>{item.descAr}</p></div>
          </div>
          <div className="catalog-tags">{item.departments.map((id) => <span key={id} className="badge">{ROOM_DISPLAY[id]?.label ?? id}</span>)}</div>
          {connection && <p className="field-note"><Check size={14} className="inline-icon" />متصل في المعاينة · آخر مزامنة {dateFormat.format(new Date(connection.lastSyncAt ?? connection.connectedAt))}</p>}
          <div className="integration-actions">
            {connection ? <><button type="button" className="button small" onClick={() => { sync(item.id); setFeedback(`تمت المزامنة التجريبية لـ ${item.nameEn}.`); }}><RefreshCw size={14} />مزامنة تجريبية</button><button type="button" className="button ghost small" onClick={() => { disconnect(item.id); setFeedback(`تم فصل ${item.nameEn} من المعاينة.`); }}><Unplug size={14} />فصل</button></> : <button type="button" className="button small" aria-label={`تجربة ربط ${item.nameEn}`} onClick={() => { connect(item.id); setFeedback(`تمت تجربة ربط ${item.nameEn}.`); }}><Link2 size={15} />تجربة الربط</button>}
          </div>
        </article>;
      })}</div> : <EmptyState icon={Plug2} title="لا توجد تكاملات مطابقة"><button className="text-link" type="button" onClick={() => { setQuery(''); setCategory('all'); setRoom('all'); setConnectedOnly(false); setFeedback(''); }}>عرض كل التكاملات</button></EmptyState>}
    </>
  );
}
