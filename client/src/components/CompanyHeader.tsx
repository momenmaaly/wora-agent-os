import { UsersRound, Moon, Sun, Radio, WifiOff, Footprints, Maximize2, UserPlus, Crown } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { WoraMark } from './WoraMark.js';

export function CompanyHeader() {
  const connected = useWoraStore(s=>s.connected);
  const demoMode = useWoraStore(s=>s.demoMode);
  const agentsCount = useWoraStore(s=>Object.keys(s.agents).length);
  const theme = useWoraStore(s=>s.ui.theme);
  const autoRoam = useWoraStore(s=>s.ui.autoRoam);
  const toggleTheme = useWoraStore(s=>s.toggleTheme);
  const toggleAutoRoam = useWoraStore(s=>s.toggleAutoRoam);
  const openHire = useWoraStore(s=>s.ui.showHireModal);
  const setShowHireModal = useWoraStore(s=>s.setShowHireModal);
  const callStandup = useWoraStore(s=>s.callTeamStandup);
  const returnDesks = useWoraStore(s=>s.returnAllToDesks);
  const resetCamera = useWoraStore(s=>s.resetCamera);
  const plan = useBillingStore(s=>s.plan);
  const setPlan = useBillingStore(s=>s.setPlan);

  return (
    <header className="relative z-30 flex h-[60px] shrink-0 items-center gap-3 border-b border-stone-200 bg-white/90 px-3 shadow-[0_1px_12px_rgba(11,15,25,.06)] backdrop-blur-xl dark:bg-[#0B0F19]/90 dark:border-white/10 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <WoraMark size={38}/>
        <span className="hidden h-8 w-px bg-stone-200 dark:bg-white/10 sm:block"/>
        <div className="hidden flex-col sm:flex">
          <span className="text-[11px] font-bold tracking-wide text-stone-500">المقر الحي — 10 أقسام تعمل الآن</span>
          <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">غرف حقيقية · ممرات · وكلاء يتعاونون أمامك</span>
        </div>
      </div>

      <div className="hidden flex-1 items-center justify-center gap-2 lg:flex">
        <button onClick={callStandup} className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-bold hover:bg-stone-50 dark:border-white/10 dark:bg-white/5">اجتماع عام</button>
        <button onClick={returnDesks} className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-bold hover:bg-stone-50 dark:border-white/10 dark:bg-white/5"><Footprints className="mr-1 inline h-3.5 w-3.5"/> عودة للمكاتب</button>
        <button onClick={resetCamera} className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-bold hover:bg-stone-50 dark:border-white/10 dark:bg-white/5"><Maximize2 className="mr-1 inline h-3.5 w-3.5"/> توسيط</button>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold sm:inline-flex ${connected ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30' : demoMode ? 'border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/30' : 'border-stone-200 bg-white text-stone-500'}`}>
          {connected ? <Radio className="h-3 w-3 animate-pulse"/> : <WifiOff className="h-3 w-3"/>}
          <span className="hidden md:inline">{connected ? 'مباشر' : demoMode ? 'معاينة' : 'غير متصل'}</span>
          <span className="hidden h-3 w-px bg-current opacity-20 md:block"/>
          <span className="hidden md:inline-flex items-center gap-1"><UsersRound className="h-3 w-3 opacity-60"/>{agentsCount} وكيل</span>
        </div>

        <button onClick={toggleAutoRoam} className={`rounded-full border px-2.5 py-1.5 text-xs font-bold ${autoRoam ? 'border-slate-900 bg-slate-900 text-white' : 'border-stone-200 bg-white text-stone-500'}`}>{autoRoam ? 'جولات تلقائية' : 'بدون جولات'}</button>

        {/* Plan switch */}
        <div className="hidden items-center rounded-full border border-stone-200 bg-stone-50 p-1 sm:flex">
          <button onClick={()=>setPlan('free')} className={`rounded-full px-3 py-1 text-xs font-bold ${plan==='free' ? 'bg-white shadow text-slate-900' : 'text-stone-500'}`}>Free</button>
          <button onClick={()=>setPlan('pro')} className={`rounded-full px-3 py-1 text-xs font-bold ${plan==='pro' ? 'bg-slate-900 text-white shadow' : 'text-stone-500'}`}>Pro <Crown className="ml-1 inline h-3 w-3 text-amber-400"/></button>
        </div>

        <button onClick={()=>setShowHireModal(!openHire)} className="inline-flex items-center gap-1.5 rounded-full bg-[#0B0F19] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-black dark:bg-white dark:text-slate-900"><UserPlus className="h-3.5 w-3.5"/><span className="hidden sm:inline">توظيف</span></button>
        <button onClick={toggleTheme} className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-white/10 dark:bg-white/5">{theme==='dark' ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}</button>
      </div>
    </header>
  );
}
