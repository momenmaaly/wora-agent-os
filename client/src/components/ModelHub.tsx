import { useMemo, useState } from 'react';
import { Box, Cpu, KeyRound, Layers3, Search, Sparkles, Zap } from 'lucide-react';
import { MODEL_CATALOG, DEPARTMENTS, type ModelTier } from '../office/models.js';
import { FREE_MODEL_IDS } from '../billing/plans.js';
import { PROVIDER_VISUALS } from '../office/layout.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { BRAIN_MODELS, BrainProvider } from '../types.js';
import { EmptyState, Notice, PageHeader } from './ui.js';

const TIERS: Record<ModelTier, { label: string; tone: string }> = {
  flagship: { label: 'متقدّم', tone: 'violet' }, balanced: { label: 'متوازن', tone: 'cyan' },
  fast: { label: 'سريع', tone: 'mint' }, specialized: { label: 'متخصص', tone: 'gold' },
};
const PROVIDERS = Array.from(new Set(MODEL_CATALOG.map((model) => model.provider)));
const SUPPORTED = new Set<string>(Object.values(BRAIN_MODELS).flat());

export function ModelHub({ onUpgrade }: { onUpgrade: () => void }) {
  const pro = useBillingStore((s) => s.plan === 'pro');
  const [provider, setProvider] = useState('all');
  const [department, setDepartment] = useState('all');
  const [query, setQuery] = useState('');
  const [showKeysInfo, setShowKeysInfo] = useState(false);
  const filtered = useMemo(() => MODEL_CATALOG.filter((model) => (
    (provider === 'all' || model.provider === provider) &&
    (department === 'all' || model.departments.some((item) => item === department)) &&
    `${model.displayName} ${model.id} ${model.family} ${model.strengths.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [provider, department, query]);

  return (
    <>
      <PageHeader icon={Cpu} eyebrow="الإدارة" title="مكتبة النماذج" description="قارن بين النماذج حسب المزوّد أو التخصص. لتغيير نموذج وكيل، اختَره من المقر التفاعلي."
        action={<><button type="button" className="button" aria-expanded={showKeysInfo} onClick={() => setShowKeysInfo(!showKeysInfo)}><KeyRound size={16} />إعداد المزوّدين</button>{!pro && <button type="button" className="button primary" onClick={onUpgrade}><Sparkles size={16} />عرض الخطط</button>}</>} />
      {showKeysInfo && <Notice><strong>تشغيل النماذج الفعلي يتطلب إعداداً على الخادم.</strong> يدعم الخادم موفّري Google وOpenAI وAnthropic وGroq. لا تحفظ مفاتيح API في المتصفح. النماذج الأخرى معروضة كمرجع للمقارنة.</Notice>}
      <section className="panel catalog-toolbar panel-pad">
        <label className="catalog-search"><Search size={18} /><input type="search" className="field" aria-label="البحث عن نموذج" placeholder="ابحث باسم النموذج أو إحدى قدراته..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="field" value={provider} aria-label="تصفية حسب المزوّد" onChange={(event) => setProvider(event.target.value)}><option value="all">كل المزوّدين</option>{PROVIDERS.map((item) => <option value={item} key={item}>{PROVIDER_VISUALS[item]?.fullLabel ?? item}</option>)}</select>
        <select className="field" value={department} aria-label="تصفية حسب التخصص" onChange={(event) => setDepartment(event.target.value)}><option value="all">كل التخصصات</option>{DEPARTMENTS.map((item) => <option value={item.id} key={item.id}>{item.nameAr}</option>)}</select>
      </section>
      <div className="catalog-count" role="status">{filtered.length} نموذج من {MODEL_CATALOG.length}</div>
      {filtered.length ? <div className="catalog-grid">
        {filtered.map((model) => {
          const tier = TIERS[model.tier];
          const vis = PROVIDER_VISUALS[model.provider];
          const activeProvider = Object.values(BrainProvider).some((id) => id === model.provider) && SUPPORTED.has(model.id);
          return <article key={model.id} className="panel catalog-card">
            <div className="catalog-head"><span className="catalog-symbol" style={{ '--catalog-color': vis?.color ?? '#8b70e8' } as React.CSSProperties}><Cpu size={19} /></span><div><h2><bdi>{model.displayName}</bdi></h2><small><bdi>{vis?.fullLabel ?? model.provider}</bdi></small></div><span className={`badge tint tone-${tier.tone}`}>{tier.label}</span></div>
            <div className="catalog-tags">{model.strengths.map((strength) => <span className="badge" key={strength}>{strength}</span>)}</div>
            <div className="catalog-detail"><span title="نافذة السياق"><Layers3 size={14} /><bdi>{model.contextWindow}</bdi></span><span title="الزمن التقديري"><Zap size={14} /><bdi>{model.speedMs} ms</bdi></span><span title="فئة التكلفة" dir="ltr">{model.cost}</span></div>
            <div className="catalog-tail"><span>{activeProvider ? 'مدعوم في إعدادات الوكلاء' : 'للمقارنة فقط'}</span><small className="badge" dir="ltr">{FREE_MODEL_IDS.has(model.id) ? 'Free' : 'Pro'}</small></div>
          </article>;
        })}
      </div> : <EmptyState icon={Box} title="لا توجد نماذج مطابقة"><button type="button" className="text-link" onClick={() => { setProvider('all'); setDepartment('all'); setQuery(''); }}>إعادة ضبط الفلاتر</button></EmptyState>}
    </>
  );
}
