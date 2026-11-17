import { useState, useMemo } from 'react';
import { Cpu, KeyRound, Search, Sparkles, Zap, Eye, EyeOff, Check, Plus, Gift, TrendingUp } from 'lucide-react';
import { MODEL_CATALOG, DEPARTMENTS, getModelById, loadBYOK, saveBYOK, hasBYOK } from '../office/models.js';
import { PROVIDER_VISUALS } from '../office/layout.js';
import { BrainProvider } from '../types.js';

export function ModelHub() {
  const [filterDept, setFilterDept] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [byok, setByok] = useState(()=>loadBYOK());
  const [keyInputs, setKeyInputs] = useState<Record<string,string>>({});
  const [showKey, setShowKey] = useState<Record<string,boolean>>({});

  const providers = useMemo(()=> Array.from(new Set(MODEL_CATALOG.map(m=>m.provider))), []);

  const filtered = useMemo(()=>{
    return MODEL_CATALOG.filter(m=>{
      if (filterDept!=='all' && !m.departments.includes(filterDept as never)) return false;
      if (search && !(`${m.displayName} ${m.id} ${m.family} ${m.strengths.join(' ')}`.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    });
  }, [filterDept, search]);

  const saveKey = (provider:string) => {
    const val = keyInputs[provider]?.trim();
    if (!val) return;
    const next = { ...byok, [provider]: { provider, apiKey: val, addedAt: new Date().toISOString() } };
    setByok(next); saveBYOK(next); setKeyInputs(s=>({...s,[provider]:''}));
  };
  const removeKey = (provider:string) => {
    const next={...byok}; delete next[provider]; setByok(next); saveBYOK(next);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="border-b border-border bg-gradient-to-l from-violet-50 to-white px-4 py-3 dark:from-violet-950/20 dark:to-card">
        <h3 className="flex items-center gap-2 text-sm font-bold"><Cpu className="h-4 w-4 text-violet-600"/> كتالوج النماذج — كل الأقسام</h3>
        <p className="mt-1 text-xs text-muted-foreground">32 نموذج مصنفة حسب القسم. اختر موديل لكل وكيل، أو أضف مفتاحك الخاص (BYOK) لأي مزود.</p>
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-2 top-2 h-4 w-4 text-muted-foreground"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث: كود، تسويق، سريع، gemini..." className="h-8 w-full rounded-full border border-border bg-white pr-8 pl-3 text-xs dark:bg-white/5"/>
          </div>
          <button onClick={()=>setShowKeys(!showKeys)} className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${showKeys?'bg-slate-900 text-white dark:bg-white dark:text-slate-900':'bg-card'}`}>
            <KeyRound className="h-3.5 w-3.5"/> {showKeys?'إخفاء المفاتيح':'مفاتيح API (BYOK)'}
          </button>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto hq-scroll pb-1">
          <button onClick={()=>setFilterDept('all')} className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold border ${filterDept==='all'?'bg-indigo-600 text-white border-indigo-600':'bg-card border-border'}`}>الكل ({MODEL_CATALOG.length})</button>
          {DEPARTMENTS.map(d=>(
            <button key={d.id} onClick={()=>setFilterDept(d.id)}
              className={`shrink-0 flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold ${filterDept===d.id?'text-white border-transparent':'bg-card border-border'}`}
              style={filterDept===d.id?{background:d.color}:{}}>
              <span>{d.icon}</span> {d.nameAr}
            </button>
          ))}
        </div>
      </div>

      {showKeys && (
        <div className="border-b border-border bg-amber-50 p-3 dark:bg-amber-950/10">
          <h4 className="flex items-center gap-2 text-xs font-bold"><KeyRound className="h-4 w-4"/> مفاتيحك الخاصة — تُحفظ محلياً فقط</h4>
          <p className="text-[11px] text-muted-foreground">أضف مفتاح API لأي مزود مشترك فيه، وسيستخدمه الوكلاء بدلاً من النموذج التجريبي.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {providers.map(p=>{
              const vis = PROVIDER_VISUALS[p] ?? { shortLabel:p, fullLabel:p, color:'#64748b', bgLight:'rgba(100,116,139,0.08)', bgDark:'rgba(100,116,139,0.14)', border:'rgba(100,116,139,0.2)' };
              const has = hasBYOK(p);
              return (
                <div key={p} className="rounded-xl border border-border bg-card p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs font-bold"><span className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{background:vis.color}}>{vis.shortLabel.slice(0,2)}</span> {vis.fullLabel}</span>
                    {has ? <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><Check className="h-3 w-3"/> مفعّل</span> : <span className="text-[10px] text-muted-foreground">غير مضاف</span>}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <div className="relative flex-1">
                      <input type={showKey[p]?'text':'password'} value={keyInputs[p] ?? ''} onChange={e=>setKeyInputs(s=>({...s,[p]:e.target.value}))} placeholder={has ? 'مفتاح جديد...' : 'sk-...'} className="h-8 w-full rounded-full border border-border bg-white px-3 pr-8 text-xs dark:bg-white/5"/>
                      <button onClick={()=>setShowKey(s=>({...s,[p]:!s[p]}))} className="absolute left-1 top-1 h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted">{showKey[p]?<EyeOff className="h-3.5 w-3.5"/>:<Eye className="h-3.5 w-3.5"/>}</button>
                    </div>
                    <button onClick={()=>saveKey(p)} className="rounded-full bg-indigo-600 px-3 text-xs font-bold text-white">حفظ</button>
                    {has && <button onClick={()=>removeKey(p)} className="rounded-full border border-border px-2 text-xs">حذف</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 hq-scroll">
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map(m=>{
            const vis = PROVIDER_VISUALS[m.provider] ?? { shortLabel:m.provider, fullLabel:m.provider, color:'#64748b', bgLight:'rgba(100,116,139,0.08)', bgDark:'rgba(100,116,139,0.14)', border:'rgba(100,116,139,0.2)' };
            const hasKey = hasBYOK(m.provider as string);
            return (
              <div key={m.id} className="rounded-2xl border border-border bg-card p-3 hover:shadow-sm transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[9px] font-bold text-white" style={{background:vis.color}}>{vis.shortLabel.slice(0,2)}</span>
                    <div>
                      <div className="text-xs font-bold leading-none">{m.displayName}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{m.id}</div>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${m.tier==='flagship'?'bg-amber-100 text-amber-700 border-amber-200': m.tier==='fast'?'bg-emerald-100 text-emerald-700 border-emerald-200':'bg-slate-100 text-slate-700 border-slate-200'}`}>{m.tier}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.strengths.slice(0,3).map(s=> <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">{s}</span>)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.departments.map(d=>{
                    const dep = DEPARTMENTS.find(x=>x.id===d);
                    return dep ? <span key={d} className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white" style={{background:dep.color}}>{dep.icon} {dep.nameAr.split(' ')[0]}</span> : null;
                  })}
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-muted-foreground"><Zap className="h-3 w-3"/> {m.speedMs}ms · {m.contextWindow}</span>
                  <span className="font-bold">{m.cost}</span>
                  {hasKey && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"><KeyRound className="h-3 w-3"/> BYOK</span>}
                </div>
                {m.recommended && <div className="mt-2 flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700"><Sparkles className="h-3 w-3"/> موصى به</div>}
              </div>
            );
          })}
        </div>
        {filtered.length===0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">لا نتائج</div>}
      </div>
      <div className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-2">
        <Gift className="h-3.5 w-3.5"/> نصيحة: اختر <b>flagship</b> للمهام الحرجة، <b>fast</b> للدعم والمحادثات، و <b>balanced</b> للاستخدام اليومي.
      </div>
    </div>
  );
}
