import { useState } from 'react';
import { Plug2, Check, RefreshCw, Unplug, Search, ShieldCheck, Zap } from 'lucide-react';
import { INTEGRATIONS, integrationsForRoom } from '../integrations/catalog.js';
import { useIntegrationsStore } from '../store/useIntegrationsStore.js';
import { OFFICE_ROOMS } from '../office/layout.js';

const CATS = [
  {id:'code', label:'البرمجة', color:'#0B0F19'},
  {id:'design', label:'التصميم', color:'#1ABCFE'},
  {id:'plan', label:'التخطيط والمنتج', color:'#CBA36B'},
  {id:'marketing', label:'التسويق', color:'#0866FF'},
  {id:'sales', label:'المبيعات والدعم', color:'#25D366'},
  {id:'data', label:'البيانات', color:'#E37400'},
] as const;

export function IntegrationsHub(){
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [q, setQ] = useState('');
  const conns = useIntegrationsStore(s=>s.connections);
  const connect = useIntegrationsStore(s=>s.connect);
  const disconnect = useIntegrationsStore(s=>s.disconnect);

  const filtered = INTEGRATIONS.filter(i=>{
    if(roomFilter!=='all' && !i.departments.includes(roomFilter)) return false;
    if(q && !`${i.nameAr} ${i.nameEn} ${i.descAr}`.includes(q)) return false;
    return true;
  });
  const connectedCount = Object.keys(conns).length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 bg-gradient-to-l from-stone-50 to-white px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-display text-[16px] font-[800]"><Plug2 className="h-4 w-4"/> مركز التكاملات — لكل قسم تكامله</h3>
            <p className="mt-1 text-xs leading-5 text-stone-600">اربط البرمجة بـ GitHub/Vercel، التصميم بـ Figma، التسويق بـ Meta/TikTok/WhatsApp، المبيعات بـ Stripe — وسيعمل الوكلاء مباشرة على حساباتك.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-800">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/>{connectedCount} متصلة من {INTEGRATIONS.length}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-stone-400"/>
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث: GitHub, Notion, WhatsApp..." className="h-9 w-full rounded-full border border-stone-200 bg-white pr-9 pl-3 text-sm outline-none focus:border-stone-300"/>
          </div>
          <span className="hidden items-center gap-1 rounded-full bg-stone-900 px-3 py-1 text-xs font-bold text-white sm:inline-flex"><ShieldCheck className="h-3.5 w-3.5"/> OAuth آمن</span>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto hq-scroll pb-1">
          <button onClick={()=>setRoomFilter('all')} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${roomFilter==='all'?'bg-slate-900 text-white border-slate-900':'bg-white border-stone-200'}`}>كل الأقسام ({INTEGRATIONS.length})</button>
          {OFFICE_ROOMS.map(r=>(
            <button key={r.id} onClick={()=>setRoomFilter(r.id)} className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${roomFilter===r.id ? 'text-white border-transparent':'bg-white border-stone-200'}`} style={roomFilter===r.id ? {background:r.accent}:{}}>
              <span className="h-2 w-2 rounded-full" style={{background:r.accent}}/>{r.nameAr.split(' ').slice(0,2).join(' ')}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CATS.map(c=> <span key={c.id} className="rounded-full border bg-white px-2.5 py-1 text-[11px] font-bold" style={{borderColor:c.color+'30', color:c.color}}>{c.label}</span>)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 hq-scroll bg-stone-50">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(intg=>{
            const conn = conns[intg.id];
            const isOn = !!conn;
            return (
              <div key={intg.id} className={`relative overflow-hidden rounded-2xl border bg-white p-4 transition ${isOn ? 'border-emerald-200 shadow-sm' : 'border-stone-200 hover:shadow-sm'}`}>
                {isOn && <div className="absolute left-0 top-0 h-full w-1 bg-emerald-500"/>}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black text-white" style={{background:intg.color}}>{intg.icon}</div>
                    <div>
                      <div className="text-sm font-bold leading-none">{intg.nameAr}</div>
                      <div className="text-[11px] text-stone-500">{intg.nameEn} · {intg.descAr}</div>
                    </div>
                  </div>
                  {isOn ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><Check className="h-3 w-3"/> متصل</span> : <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-500">غير متصل</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {intg.departments.map(d=>{
                    const room = OFFICE_ROOMS.find(r=>r.id===d);
                    return room ? <span key={d} className="rounded-full bg-stone-50 border border-stone-200 px-1.5 py-0.5 text-[10px] font-bold" style={{color:room.accent}}>{room.nameAr.split(' ')[0]}</span> : null;
                  })}
                </div>
                {isOn && conn?.accountLabel && <div className="mt-2 rounded-xl bg-stone-50 border px-2.5 py-1.5 text-xs">حساب: <b>{conn.accountLabel}</b> · <span className="text-stone-500">آخر مزامنة {new Date(conn.lastSyncAt ?? conn.connectedAt).toLocaleDateString('ar-EG')}</span></div>}
                <div className="mt-3 flex gap-1.5">
                  {isOn ? (
                    <>
                      <button onClick={()=>disconnect(intg.id)} className="flex flex-1 items-center justify-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold hover:bg-stone-50"><Unplug className="h-3.5 w-3.5"/> فصل</button>
                      <button className="flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"><RefreshCw className="h-3.5 w-3.5"/> مزامنة</button>
                    </>
                  ) : (
                    <button onClick={()=>connect(intg.id, `demo@${intg.id}.com`)} className="flex w-full items-center justify-center gap-1.5 rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black"><Zap className="h-3.5 w-3.5 text-amber-400"/> ربط {intg.nameAr}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length===0 && <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-stone-500">لا نتائج</div>}
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
          <b>كيف تعمل؟</b> عند ربط GitHub سيُنشئ وكيل الهندسة PRs حقيقية، وعند ربط Meta/WhatsApp سيرسل وكيل التسويق حملات باسمك — كل تكامل يظهر مباشرة في غرفته على الخريطة.
        </div>
      </div>
    </div>
  );
}
