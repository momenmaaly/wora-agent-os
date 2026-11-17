import { ArrowLeft, Building2, Check, CreditCard, Sparkles, Zap } from 'lucide-react';
import { PLANS, PRO_ROOM_IDS } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { ROOM_BY_ID } from '../office/layout.js';
import { IconTile, Notice, PageHeader } from './ui.js';

const FEATURES = {
  free: ['الأقسام الأساسية وخريطة المقر التفاعلية', 'إدارة مشروعين ومهام الفريق', 'لوحة المنتجات وبنك الأفكار', 'محادثة الفريق وتجربة التكاملات'],
  pro: ['كل مميزات الخطة المجانية', 'مساحة أكبر للمشاريع والمهام والمنتجات', 'استوديو المنتج لإنشاء مسودات محلية', 'فتح أقسام القيادة والتصميم والبيانات'],
};

export function PricingPlans({ onStudio }: { onStudio: () => void }) {
  const plan = useBillingStore((s) => s.plan);
  const setPlan = useBillingStore((s) => s.setPlan);
  return (
    <>
      <PageHeader icon={CreditCard} eyebrow="إدارة المساحة" title="خطط Wora" description="اختَر مساحة العمل المناسبة لفريقك، وجرب مميزات كل خطة قبل اتخاذ القرار." />
      <Notice>تغيير الخطة في هذه النسخة <strong>تجريبي ومحلي</strong>؛ لا ينشئ اشتراكاً ولا يتطلب أي بيانات دفع.</Notice>
      <div className="price-grid">
        {(['free', 'pro'] as const).map((id) => {
          const config = PLANS[id];
          const pro = id === 'pro';
          const current = plan === id;
          return <section className={`panel price-card${pro ? ' is-pro' : ''}`} key={id}>
            <div className="price-head"><IconTile icon={pro ? Sparkles : Zap} tone={pro ? 'violet' : 'cyan'} /><div><h2><bdi>{config.nameEn}</bdi></h2><p>{pro ? 'لأكثر من مشروع ولتجربة استوديو المنتج' : 'للتعرّف على المقر وتنظيم أول مشروع'}</p></div>{current && <span className="badge tint tone-mint"><Check size={13} />الخطة الحالية</span>}</div>
            <div className="price-value">{pro ? <><strong>{config.priceSAR}</strong><span>ر.س / شهرياً<br /><small>السعر المقترح</small></span></> : <strong>مجاناً</strong>}</div>
            <ul className="price-features">{FEATURES[id].map((feature) => <li key={feature}><Check size={16} />{feature}</li>)}</ul>
            {current && pro ? <button type="button" className="button primary" onClick={onStudio}>افتح استوديو المنتج <ArrowLeft size={16} /></button> : <button type="button" className={`button ${pro ? 'primary' : ''}`} disabled={current} onClick={() => setPlan(id)}>{current ? 'مفعّلة في المعاينة' : pro ? 'جرّب Wora Pro' : 'العودة للخطة المجانية'}</button>}
          </section>;
        })}
      </div>
      <section className="panel panel-pad premium-rooms">
        <div className="section-bar"><div><h2>مساحات إضافية مع <bdi>Pro</bdi></h2><p>ثلاث غرف إضافية على الخريطة، لكل واحدة مساحة عمل مخصّصة.</p></div></div>
        <div className="catalog-grid">{PRO_ROOM_IDS.map((id) => <article className="catalog-card" key={id}><div className="catalog-head"><IconTile icon={Building2} /><div><h3>{ROOM_BY_ID[id]?.nameAr}</h3><p>{ROOM_BY_ID[id]?.subtitleAr}</p></div></div></article>)}</div>
      </section>
    </>
  );
}
