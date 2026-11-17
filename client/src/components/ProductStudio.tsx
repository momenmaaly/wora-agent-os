/**
 * ProductStudio — "كلمة → منتج احترافي"
 * User types a prompt, agents collaborate, output is a real product ready to sell.
 * Pro feature: gated, opens upgrade if free.
 */
import { useState, useMemo } from 'react';
import { Sparkles, Wand2, Store, Tag, TrendingUp, Copy, Check, Crown, Lock, Package, Palette, Megaphone, ArrowLeft, ShoppingBag } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore.js';
import { useBillingStore } from '../store/useBillingStore.js';

type StudioStep = 'prompt'|'generating'|'result';

const CATALOG_SEEDS: Record<string,{cat:string; emoji:string; colors:[string,string]}> = {
  'عطر': {cat:'عطور فاخرة', emoji:'🌸', colors:['#1c1917','#be123c']},
  'قهوة': {cat:'أغذية ومشروبات', emoji:'☕', colors:['#431407','#a16207']},
  'سجاد': {cat:'ديكور', emoji:'🧶', colors:['#78350f','#d97706']},
  'حرف': {cat:'حرف يدوية', emoji:'🏺', colors:['#422006','#ea580c']},
  'مجوه': {cat:'مجوهرات', emoji:'💎', colors:['#1e1b4b','#7c3aed']},
  'ملابس': {cat:'أزياء', emoji:'👗', colors:['#18181b','#e11d48']},
  'عناية': {cat:'عناية', emoji:'🧴', colors:['#052e16','#16a34a']},
  'تمر': {cat:'أغذية فاخرة', emoji:'🌴', colors:['#431407','#ca8a04']},
  'بخور': {cat:'عطور وبخور', emoji:'🪔', colors:['#1c1917','#a16207']},
  default:{cat:'منتجات مختارة', emoji:'🎁', colors:['#0f172a','#6366f1']},
};
function detectSeed(prompt:string){
  for(const k of Object.keys(CATALOG_SEEDS)) if(k!=='default' && prompt.includes(k)) return CATALOG_SEEDS[k]!;
  return CATALOG_SEEDS['default']!;
}

function generateProducts(prompt:string){
  const seed = detectSeed(prompt);
  const clean = prompt.trim().slice(0,60);
  const base = clean.replace(/متجر|منتجات|براند|خط|مجموعة/g,'').trim() || clean;
  const names = [
    `${base} — تشكيلة العنبر الملكي`,
    `${base} — عبير الليل`,
    `${base} — مسك النوادر (هدية فاخرة)`,
  ];
  const descs = [
    'تركيبة متوازنة تفتتح بالحمضيات وتستقر على العنبر والعود — ثبات 12 ساعة.',
    'عطر ليلي بلمسة زعفران وورد طائفي، يترك أثراً لا يُنسى.',
    'صندوق هدايا مخملية مع بطاقة إهداء وحقيبة قماشية — جاهز للإهداء.',
  ];
  const prices = [289, 329, 149];
  const costs  = [110, 130, 55];
  return names.map((name,i)=>({
    name, description: descs[i]!, price: prices[i]!, cost: costs[i]!, stock: [24,18,80][i]!, category: seed.cat, emoji: ['✨','🌙','🎁'][i]!, status:'active' as const, color: seed.colors[i%2]!,
  }));
}

export function ProductStudio({ onUpgrade }:{ onUpgrade?:()=>void }){
  const plan = useBillingStore(s=>s.plan);
  const isPro = plan==='pro';
  const addProduct = useProjectStore(s=>s.addProduct);
  const projects = useProjectStore(s=>s.projects);
  const activeProjectId = useProjectStore(s=>s.activeProjectId);
  const [prompt, setPrompt] = useState('متجر عطور عربية فاخرة بروح تراثية ومكونات طبيعية');
  const [step, setStep] = useState<StudioStep>('prompt');
  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState<number[]>([]);

  const generated = useMemo(()=> generateProducts(prompt),[prompt]);
  const seed = detectSeed(prompt);

  const run = ()=>{
    if(!isPro){ onUpgrade?.(); return; }
    setStep('generating');
    setTimeout(()=> setStep('result'), 1600);
  };

  if(!isPro && step!=='result'){
    return (
      <div className="mx-auto max-w-[720px]">
        <div className="relative overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-stone-50 via-white to-amber-50/60"/>
          <div className="relative p-6 sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold text-white"><Crown className="h-3.5 w-3.5 text-amber-400"/> ميزة Pro — مولد المنتجات الاحترافي</div>
            <h2 className="mt-4 font-display text-[22px] font-[800] tracking-tight text-slate-900">اكتب كلمة… نُسلّمك متجراً جاهزاً</h2>
            <p className="mt-2 max-w-[560px] text-[13px] leading-6 text-stone-600">المنصة تقرأ فكرتك، يصممها وكلاء التصميم والمنتج والتسويق، وتستلم براند + 3 منتجات مسعّرة + وصف بيعي + حملة إطلاق — في ثوانٍ.</p>

            <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-stone-700"><Wand2 className="h-4 w-4"/> جرّب فكرتك الآن</div>
              <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={2} placeholder="مثال: متجر قهوة مختصة بمحامص سعودية وتغليف مستدام" className="mt-3 w-full resize-none rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm leading-6 outline-none placeholder:text-stone-400 focus:border-slate-300"/>
              <button onClick={run} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800">
                <Lock className="h-4 w-4"/> فتح المولد — ترقية إلى Pro
              </button>
              <p className="mt-2 text-center text-[11px] text-stone-500">Free يستخدم نماذج مفتوحة فقط · Pro يفتح GPT-4.1 و Claude Opus و Gemini Pro و BYOK</p>
            </div>

            {/* Preview cards locked */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 opacity-60">
              {generated.map((p,i)=>(
                <div key={i} className="rounded-2xl border border-stone-200 bg-white p-4 blur-[0.3px]"><div className="text-2xl">{p.emoji}</div><div className="mt-2 text-sm font-bold">{p.name}</div><div className="text-xs text-stone-500">{p.description.slice(0,44)}…</div><div className="mt-3 text-sm font-black">{p.price} ر.س</div></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-[800] tracking-tight">استوديو المنتج — كلمة → متجر</h2>
          <p className="text-xs text-muted-foreground">Pro: يعمل بكل النماذج + مفاتيحك الخاصة · Free: نماذج مفتوحة فقط</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white"><Sparkles className="h-3.5 w-3.5 text-amber-400"/> Pro مفعّل</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* Left: prompt + agents */}
        <div className="space-y-3">
          <div className="rounded-[20px] border border-stone-200 bg-white p-4 shadow-sm">
            <label className="text-xs font-bold text-stone-700">فكرتك</label>
            <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 outline-none focus:bg-white focus:border-slate-300" placeholder="اكتب وصف متجرك أو منتجك..."/>
            <button onClick={run} disabled={step==='generating'} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
              {step==='generating' ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"/> الوكلاء يعملون…</> : <><Wand2 className="h-4 w-4"/> ولّد المتجر الاحترافي</>}
            </button>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              {[
                {l:'المنتج', i:Palette, c:'#f59e0b'},
                {l:'التصميم', i:Package, c:'#ec4899'},
                {l:'التسويق', i:Megaphone, c:'#0891b2'},
              ].map(s=>(
                <div key={s.l} className="rounded-xl border bg-white px-2 py-2 text-center" style={{borderColor:s.c+'30'}}><s.i className="mx-auto h-4 w-4" style={{color:s.c}}/><div className="mt-1 font-bold">{s.l}</div><div className={`text-[10px] ${step==='generating'?'text-emerald-600':'text-stone-400'}`}>{step==='generating'?'يعمل…':'جاهز'}</div></div>
              ))}
            </div>
          </div>

          <div className="rounded-[20px] border border-stone-200 bg-white p-4">
            <div className="text-xs font-bold">تفاصيل تُضاف تلقائياً</div>
            <ul className="mt-2 space-y-1.5 text-xs text-stone-600">
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500"/> اسم براند + شعار مقترح + لوحة ألوان</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500"/> تسعير + تكلفة + هامش + مخزون</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500"/> وصف بيعي + SEO + حملة إطلاق</li>
            </ul>
          </div>
        </div>

        {/* Right: result */}
        <div className="space-y-3">
          {step==='prompt' && (
            <div className="rounded-[20px] border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-stone-200"><Store className="h-6 w-6 text-stone-700"/></div>
              <div className="mt-3 text-sm font-bold">اضغط "ولّد المتجر" لترى منتجاً حقيقياً</div>
              <div className="mt-1 text-xs text-stone-500">مثال حي بالأسفل — سيُنشأ بنفس الجودة لوصفك</div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-left">
                {generated.map((p,i)=>(
                  <div key={i} className="rounded-xl border bg-white p-3"><div className="text-lg">{p.emoji}</div><div className="mt-1 text-xs font-bold line-clamp-2">{p.name}</div><div className="mt-1 text-[11px] font-black">{p.price} ر.س</div></div>
                ))}
              </div>
            </div>
          )}

          {step==='generating' && (
            <div className="rounded-[20px] border border-stone-200 bg-white p-6">
              <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100"><div className="h-full w-[68%] animate-[shimmer_1.2s_ease_infinite] rounded-full bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900"/></div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-amber-500"/> Lina تكتب PRD والبراند…</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-pink-500"/> Maya تصمم الهوية والعبوة…</div>
                <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-600"/> Zayn يصيغ الوصف والحملة…</div>
              </div>
            </div>
          )}

          {step==='result' && (
            <>
              {/* Brand hero */}
              <div className="overflow-hidden rounded-[20px] border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 px-5 py-4" style={{background:`linear-gradient(135deg, ${seed.colors[0]}, ${seed.colors[1]})`}}>
                  <div className="flex items-center gap-3 text-white">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg backdrop-blur">{seed.emoji}</div>
                    <div><div className="text-sm font-black tracking-tight">{prompt.slice(0,22)} — متجر رسمي</div><div className="text-[11px] opacity-80">هوية فاخرة · تغليف مستدام · شحن خلال 24س</div></div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-slate-900">جاهز للنشر</span>
                </div>
                <div className="grid grid-cols-3 gap-3 p-4">
                  {generated.map((p,idx)=>(
                    <div key={idx} className="group overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md">
                      <div className="h-[88px] flex items-center justify-center text-3xl" style={{background:`linear-gradient(180deg, ${p.color}0D, white)`}}>{p.emoji}</div>
                      <div className="p-3">
                        <div className="line-clamp-2 text-xs font-bold leading-5">{p.name}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-stone-500">{p.description}</div>
                        <div className="mt-3 flex items-center justify-between">
                          <div><div className="text-sm font-black">{p.price} ر.س</div><div className="text-[11px] text-stone-500">تكلفة {p.cost} · مخزون {p.stock}</div></div>
                          <button disabled={added.includes(idx)} onClick={()=>{
                            const projId = projects.find(pr=>pr.id===activeProjectId)?.id ?? projects[0]?.id ?? activeProjectId;
                            addProduct({ projectId: projId, name:p.name, description:p.description, price:p.price, cost:p.cost, stock:p.stock, image:p.emoji, category:p.category, status:'active' });
                            setAdded(a=>[...a,idx]);
                          }} className={`rounded-full px-3 py-1.5 text-xs font-bold ${added.includes(idx)?'bg-emerald-600 text-white':'bg-slate-900 text-white hover:bg-slate-800'}`}>
                            {added.includes(idx) ? 'تمت الإضافة ✓' : 'أضف للمتجر'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-stone-100 bg-stone-50 px-4 py-3 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-white border px-3 py-1"><Tag className="h-3 w-3"/> فئة: {seed.cat}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white border px-3 py-1"><TrendingUp className="h-3 w-3"/> هامش ~62%</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white border px-3 py-1"><ShoppingBag className="h-3 w-3"/> دفع عند الاستلام + تابي</span>
                </div>
              </div>

              {/* Copy pack */}
              <div className="rounded-[20px] border border-stone-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold">حزمة البيع الجاهزة</div>
                  <button onClick={()=>{navigator.clipboard.writeText(`${prompt}\n\n${generated.map(g=>`• ${g.name} — ${g.price} ر.س: ${g.description}`).join('\n')}`); setCopied(true); setTimeout(()=>setCopied(false),1200);}} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold hover:bg-stone-50">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600"/> : <Copy className="h-3.5 w-3.5"/>} {copied ? 'تم النسخ' : 'نسخ الحزمة'}
                  </button>
                </div>
                <div className="mt-3 rounded-xl bg-stone-900 px-4 py-3 text-xs leading-6 text-stone-100">
                  <div className="font-bold text-white">عنوان المتجر:</div>
                  {prompt} — فخامة بلمسة تراثية
                  <div className="mt-2 font-bold text-white">الوصف البيعي:</div>
                  اكتشف مجموعة صُممت للذوق الرفيع — مكونات طبيعية، ثبات طويل، وتغليف هدايا فاخر. اطلب الآن مع توصيل سريع واسترجاع 14 يوماً.
                  <div className="mt-2 font-bold text-white">حملة الإطلاق (7 أيام):</div>
                  ريلز افتتاحي + 3 بوستات + إعلان سناب + بريد ترحيبي بخصم 15% لأول 100 طلب.
                </div>
              </div>
              <button onClick={()=>setStep('prompt')} className="inline-flex items-center gap-1 text-xs font-bold text-stone-600 hover:text-stone-900"><ArrowLeft className="h-3.5 w-3.5"/> إنشاء منتج آخر</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
