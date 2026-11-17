import { useEffect, useMemo, useState } from 'react';
import { X, Cpu, Zap, Sparkles, Check, Info } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { PROVIDER_VISUALS, formatShortModel } from '../office/layout.js';
import { BRAIN_MODELS, BRAIN_PROVIDER_LABELS, BrainProvider } from '../types.js';
import type { PublicBrainConfig } from '../types.js';

export function ModelSwapModal() {
  const agentId     = useWoraStore((s) => s.ui.modelSwapAgentId);
  const agents      = useWoraStore((s) => s.agents);
  const openSwap    = useWoraStore((s) => s.openModelSwap);
  const { swapBrain } = useSocket();

  const agent = agentId ? agents[agentId] : null;

  const [provider, setProvider] = useState<BrainProvider>(BrainProvider.Google);
  const [model, setModel]       = useState<string>('');

  useEffect(() => {
    if (agent?.brainConfig) {
      setProvider(agent.brainConfig.provider as BrainProvider);
      setModel(agent.brainConfig.model);
    }
  }, [agent?.brainConfig]);

  const modelsForProvider = useMemo(() => {
    return BRAIN_MODELS[provider] ?? [];
  }, [provider]);

  useEffect(() => {
    if (modelsForProvider.length > 0 && !modelsForProvider.includes(model)) {
      setModel(modelsForProvider[0]!);
    }
  }, [modelsForProvider, model]);

  if (!agentId || !agent) return null;

  const currentVisual = agent.brainConfig
    ? PROVIDER_VISUALS[agent.brainConfig.provider as BrainProvider]
    : null;
  const nextVisual = PROVIDER_VISUALS[provider];

  const handleConfirm = () => {
    const next: PublicBrainConfig = { provider, model };
    swapBrain(agent.id, next, 'تبديل موديل من واجهة المقر');
    openSwap(null);
  };

  const isSame =
    agent.brainConfig?.provider === provider && agent.brainConfig?.model === model;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        aria-label="إغلاق"
        onClick={() => openSwap(null)}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm dark:bg-black/60"
      />

      {/* Card */}
      <div className="relative flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
              style={{ background: agent.profile.avatarColor }}
            >
              {agent.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-bold leading-none text-foreground">{agent.displayName}</div>
              <div className="mt-1 text-xs font-medium text-muted-foreground">{agent.profile.customRole}</div>
            </div>
          </div>
          <button
            onClick={() => openSwap(null)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 hq-scroll">
          {/* Current model banner */}
          {agent.brainConfig && currentVisual && (
            <div
              className="mb-4 flex items-center gap-3 rounded-2xl border px-4 py-3"
              style={{ background: currentVisual.bgLight, borderColor: currentVisual.border }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: currentVisual.color }}
              >
                {currentVisual.shortLabel.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold" style={{ color: currentVisual.color }}>
                  الموديل الحالي
                </div>
                <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-foreground" dir="ltr">
                  <Cpu className="h-3.5 w-3.5 opacity-60" />
                  {currentVisual.shortLabel} · {formatShortModel(agent.brainConfig.model)}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                {BRAIN_PROVIDER_LABELS[agent.brainConfig.provider as BrainProvider]}
              </span>
            </div>
          )}

          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Zap className="h-4 w-4 text-amber-500" />
            اختيار المزود والموديل الجديد
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            سيتم تحديث شارة الموديل على رأس الوكيل فوراً في الخريطة، وسيظهر التبديل لجميع المتصلين بنفس الغرفة.
          </p>

          {/* Provider grid */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(BRAIN_MODELS) as BrainProvider[]).map((p) => {
              const v = PROVIDER_VISUALS[p];
              const active = provider === p;
              return (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`relative flex flex-col gap-1 rounded-2xl border px-3 py-3 text-right transition ${
                    active
                      ? 'border-indigo-300 bg-indigo-50 shadow-sm dark:border-indigo-800 dark:bg-indigo-950/30'
                      : 'border-border bg-card hover:border-indigo-200 hover:bg-muted/50'
                  }`}
                >
                  {active && (
                    <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                    style={{ background: v.color }}
                  >
                    {v.shortLabel.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-xs font-bold leading-none text-foreground">{v.fullLabel}</span>
                  <span className="text-[11px] leading-none text-muted-foreground">{BRAIN_PROVIDER_LABELS[p]}</span>
                </button>
              );
            })}
          </div>

          {/* Model list */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              موديلات {nextVisual.fullLabel}
            </div>
            <div className="flex flex-col gap-1.5">
              {modelsForProvider.map((m) => {
                const active = model === m;
                return (
                  <button
                    key={m}
                    onClick={() => setModel(m)}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-slate-900'
                        : 'border-border bg-card text-foreground hover:bg-muted'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        active ? 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {active ? <Check className="h-3.5 w-3.5" /> : m.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate text-left font-mono text-xs font-bold" dir="ltr">
                      {m}
                    </span>
                    {active && <span className="shrink-0 text-[10px] font-bold opacity-80">محدد</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
            <Info className="h-4 w-4 shrink-0" />
            التبديل فوري ويظهر كشارة ملونة فوق رأس كل وكيل — يمكنك متابعة الحركة في الخريطة بعد التأكيد.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3">
          <button
            onClick={() => openSwap(null)}
            className="rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSame}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900"
          >
            <Zap className="h-3.5 w-3.5" />
            {isSame ? 'نفس الموديل الحالي' : `تأكيد التبديل إلى ${formatShortModel(model)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
