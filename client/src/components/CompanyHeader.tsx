import {
  Building2,
  UsersRound,
  Sparkles,
  Moon,
  Sun,
  Radio,
  WifiOff,
  Footprints,
  Maximize2,
  UserPlus,
} from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';

export function CompanyHeader() {
  const connected        = useWoraStore((s) => s.connected);
  const demoMode         = useWoraStore((s) => s.demoMode);
  const agentsCount      = useWoraStore((s) => Object.keys(s.agents).length);
  const activityCount    = useWoraStore((s) => s.activityLog.length);
  const theme            = useWoraStore((s) => s.ui.theme);
  const autoRoam         = useWoraStore((s) => s.ui.autoRoam);
  const toggleTheme      = useWoraStore((s) => s.toggleTheme);
  const toggleAutoRoam   = useWoraStore((s) => s.toggleAutoRoam);
  const openHire         = useWoraStore((s) => s.ui.showHireModal);
  const setShowHireModal = useWoraStore((s) => s.setShowHireModal);
  const callStandup      = useWoraStore((s) => s.callTeamStandup);
  const returnDesks      = useWoraStore((s) => s.returnAllToDesks);
  const resetCamera      = useWoraStore((s) => s.resetCamera);

  return (
    <header className="relative z-30 flex h-[56px] shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-3 shadow-sm backdrop-blur-xl sm:px-5">
      {/* Brand */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md">
          <Building2 className="h-[18px] w-[18px]" />
        </div>
        <div className="hidden min-w-0 flex-col sm:flex">
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap font-sans text-[15px] font-bold leading-none tracking-tight text-foreground">
              Wora HQ
            </span>
            <span className="hidden rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white lg:inline-flex">
              v5.0
            </span>
          </div>
          <span className="whitespace-nowrap text-[11px] font-medium leading-none text-muted-foreground">
            مقر الشركة — غرف وطرقات حية
          </span>
        </div>
        {/* Mobile short brand */}
        <span className="font-sans text-[15px] font-bold sm:hidden">Wora HQ</span>
      </div>

      {/* Center actions — hidden on very small */}
      <div className="hidden flex-1 items-center justify-center gap-2 lg:flex">
        <button
          onClick={callStandup}
          className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-900/30"
        >
          <UsersRound className="h-3.5 w-3.5" />
          اجتماع عام
        </button>
        <button
          onClick={returnDesks}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
        >
          <Footprints className="h-3.5 w-3.5" />
          عودة للمكاتب
        </button>
        <button
          onClick={resetCamera}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
          title="إعادة ضبط الكاميرا"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          توسيط الخريطة
        </button>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {/* Live badge */}
        <div
          className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold sm:inline-flex ${
            connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300'
              : demoMode
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400'
          }`}
        >
          {connected ? (
            <Radio className="h-3 w-3 animate-pulse" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span className="hidden md:inline">
            {connected ? 'مباشر' : demoMode ? 'وضع المعاينة' : 'غير متصل'}
          </span>
          <span className="hidden h-4 w-px bg-current opacity-20 md:block" />
          <span className="hidden items-center gap-1 md:inline-flex">
            <UsersRound className="h-3 w-3 opacity-60" />
            {agentsCount} وكيل
          </span>
        </div>

        {/* Auto-roam */}
        <button
          onClick={toggleAutoRoam}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
            autoRoam
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-300'
              : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400'
          }`}
          title={autoRoam ? 'الحركة التلقائية مفعّلة' : 'الحركة التلقائية متوقفة'}
        >
          <Sparkles className={`h-3.5 w-3.5 ${autoRoam ? 'opacity-100' : 'opacity-50'}`} />
          <span className="hidden sm:inline">{autoRoam ? 'جولات تلقائية' : 'بدون جولات'}</span>
        </button>

        {/* Hire */}
        <button
          onClick={() => setShowHireModal(!openHire)}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
          <UserPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">توظيف وكيل</span>
          <span className="sm:hidden">توظيف</span>
        </button>

        {/* Theme */}
        <button
          onClick={toggleTheme}
          aria-label="تبديل المظهر"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:bg-muted"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {/* Subtle live dot for mobile when connected */}
      {connected && (
        <span className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-emerald-400 via-indigo-400 to-violet-400 opacity-60 sm:hidden" />
      )}
      {/* Activity pulse */}
      {activityCount > 0 && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent" />
      )}
    </header>
  );
}
