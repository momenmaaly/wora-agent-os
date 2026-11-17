import { Check, Crown, Sparkles, Zap, Shield } from 'lucide-react';
import { PLANS } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';

export function PricingPlans(){
  const plan = useBillingStore(s=>s.plan);
  const setPlan = useBillingStore(s=>s.setPlan);
  return (
    <div className="mx-auto max-w-[980px]">
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-bold"><Shield className="h-3.5 w-3.5"/> دفع آمن · إلغاء في أي وقت · فاتورة ضريبية</div>
        <h2 className="font-display mt-4 text-[28px] font-[900] tracking-tight">اختر خطتك — وابدأ البيع اليوم</h2>
        <p className="mx-auto mt-2 max-w-[560px] text-sm leading-6 text-stone-600">المجانية تعمل فوراً بنماذج مفتوحة سريعة. المحترفة تفتح كل العمالقة + مولد المنتجات + BYOK + أتمتة كاملة.</p>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {(['free','pro'] as const).map(id=>{
          const p = PLANS[id];
          const active = plan===id;
          const isPro = id==='pro';
          return (
            <div key={id} className={`relative overflow-hidden rounded-[24px] border bg-white shadow-sm ${active ? 'border-slate-900 ring-1 ring-slate-900' : 'border-stone-200'}`}>
              {isPro && <div className="absolute -right-10 top-5 rotate-12 rounded-full bg-amber-400 px-8 py-1 text-[11px] font-black text-slate-900">الأكثر طلباً</div>}
              <div className="p-6 sm:p-7">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isPro ? 'bg-slate-900 text-white':'bg-stone-100 text-stone-700'}`}>{isPro ? <Crown className="h-5 w-5 text-amber-400"/> : <Zap className="h-5 w-5"/>}</div>
                  <div><div className="text-sm font-black">{p.nameAr} — {p.nameEn}</div><div className="text-xs text-stone-500">{isPro ? 'للمتاجر الجادة والشركات' : 'للتجربة والبداية السريعة'}</div></div>
                  {active && <span className="ml-auto rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">خطتك الحالية</span>}
                </div>

                <div className="mt-5 flex items-end gap-2">
                  <div className="font-display text-[32px] font-[900] tracking-tight">{p.priceSAR===0 ? 'مجاناً' : `${p.priceSAR} ر.س`}</div>
                  <div className="mb-2 text-xs font-bold text-stone-500">/ {p.interval} {p.priceSAR!==0 && <span className="font-normal">· ${p.priceUSD}</span>}</div>
                </div>

                <ul className="mt-5 space-y-2.5">
                  {p.features.map(f=>(
                    <li key={f} className="flex gap-2 text-sm leading-6"><span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isPro?'bg-slate-900 text-white':'bg-stone-900 text-white'}`}><Check className="h-3.5 w-3.5"/></span><span className="text-stone-700">{f}</span></li>
                  ))}
                </ul>

                <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-xl bg-stone-50 border px-2 py-2"><div className="font-black">{p.limits.projects===999?'∞':p.limits.projects}</div><div className="text-stone-500">مشاريع</div></div>
                  <div className="rounded-xl bg-stone-50 border px-2 py-2"><div className="font-black">{p.limits.products===9999?'∞':p.limits.products}</div><div className="text-stone-500">منتجات</div></div>
                  <div className="rounded-xl bg-stone-50 border px-2 py-2"><div className="font-black">{isPro?'32':'8'}</div><div className="text-stone-500">نماذج</div></div>
                </div>

                {active ? (
                  <button disabled className="mt-6 w-full rounded-full border border-stone-200 bg-stone-50 px-5 py-3 text-sm font-bold text-stone-500">مفعّلة ✓</button>
                ) : isPro ? (
                  <button onClick={()=>setPlan('pro')} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow hover:bg-black">
                    <Sparkles className="h-4 w-4 text-amber-400"/> ترقية إلى Pro — ابدأ الآن
                  </button>
                ) : (
                  <button onClick={()=>setPlan('free')} className="mt-6 w-full rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-bold hover:bg-stone-50">العودة للمجانية</button>
                )}
                {isPro && !active && <div className="mt-2 text-center text-[11px] text-stone-500">تجربة 7 أيام · استرداد كامل · تفعيل فوري</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-[16px] border border-stone-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-black"><Crown className="h-4 w-4 text-[#CBA36B]"/> ماذا يفتح Pro في المقر؟</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            {code:'R-103', name:'القيادة التنفيذية', desc:'غرفة اجتماعات زجاجية + شرفة على الواحة', accent:'#7c3aed'},
            {code:'R-105', name:'استوديو التصميم', desc:'سكاي لايت + طاولات رسم + معرض أعمال', accent:'#ec4899'},
            {code:'R-110', name:'مركز البيانات', desc:'جدار شاشات + غرفة خوادم زجاجية', accent:'#059669'},
          ].map(r=>(
            <div key={r.code} className="rounded-xl border bg-[#FDFBF7] p-3" style={{borderColor:r.accent+'30'}}>
              <div className="flex items-center gap-2"><span className="rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{background:r.accent}}>{r.code}</span><span className="text-xs font-bold">{r.name}</span><span className="ml-auto rounded-full bg-[#CBA36B] px-1.5 py-0.5 text-[10px] font-black text-white">Pro</span></div>
              <div className="mt-1 text-[11px] text-stone-600">{r.desc}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl bg-[#0B0F19] px-3 py-2 text-center text-xs text-white">Free يرى الأجنحة الثلاثة مقفلة بهالة ذهبية — Pro يفتحها فوراً مع كل التكاملات (GitHub→Vercel, Figma, Stripe...)</div>
      </div>
      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs leading-6 text-amber-900">
        المجانية = 8 نماذج مفتوحة + 7 أجنحة + 3 تكاملات. Pro = 32 نموذج + 10 أجنحة + نشر حقيقي بلا حدود.
      </div>
    </div>
  );
}
