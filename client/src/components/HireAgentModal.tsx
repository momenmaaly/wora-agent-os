import { useMemo, useState } from 'react';
import { X, UserPlus, Building2, Palette, Cpu, Sparkles } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { OFFICE_ROOMS, PROVIDER_VISUALS, formatShortModel } from '../office/layout.js';
import { BRAIN_MODELS, BRAIN_PROVIDER_LABELS, BrainProvider } from '../types.js';

const AVATAR_COLORS = ['#4f46e5', '#0284c7', '#d97706', '#059669', '#7c3aed', '#e11d48', '#0d9488', '#334155'] as const;

export function HireAgentModal() {
  const open       = useWoraStore((s) => s.ui.showHireModal);
  const setOpen    = useWoraStore((s) => s.setShowHireModal);
  const hireAgent  = useWoraStore((s) => s.hireAgent);

  const [displayName, setDisplayName] = useState('');
  const [customRole,  setCustomRole]  = useState('');
  const [zoneId,      setZoneId]      = useState<string>(OFFICE_ROOMS[0]!.id);
  const [avatarColor, setAvatarColor] = useState<string>(AVATAR_COLORS[0]!);
  const [provider,    setProvider]    = useState<BrainProvider>(BrainProvider.Google);
  const [model,       setModel]       = useState<string>(BRAIN_MODELS[BrainProvider.Google][0]!);

  const models = useMemo(() => BRAIN_MODELS[provider] ?? [], [provider]);

  if (!open) return null;

  const canSubmit = displayName.trim().length >= 2 && customRole.trim().length >= 2;

  const handleSubmit = () => {
    if (!canSubmit) return;
    hireAgent({
      displayName: displayName.trim(),
      customRole:  customRole.trim(),
      zoneId,
      avatarColor,
      provider,
      model,
    });
    setDisplayName('');
    setCustomRole('');
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="إغلاق" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm dark:bg-black/60" />
      <div className="relative flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <UserPlus className="h-4 w-4" />
            </span>
            توظيف وكيل جديد للمقر
          </div>
          <button onClick={() => setOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 hq-scroll">
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-foreground">اسم الوكيل</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="مثال: Karim"
                className="h-10 rounded-xl border border-border bg-white px-3 text-sm font-medium outline-none placeholder:text-muted-foreground focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:bg-white/5 dark:focus:ring-indigo-900/30"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-bold text-foreground">الدور / المسمى الوظيفي</span>
              <input
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                placeholder="مثال: مهندس تجربة المستخدم"
                className="h-10 rounded-xl border border-border bg-white px-3 text-sm font-medium outline-none placeholder:text-muted-foreground focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:bg-white/5 dark:focus:ring-indigo-900/30"
              />
            </label>

            <div className="grid gap-1.5">
              <span className="flex items-center gap-1 text-xs font-bold text-foreground">
                <Building2 className="h-3.5 w-3.5 text-slate-500" />
                القسم / الغرفة الأساسية
              </span>
              <div className="grid grid-cols-2 gap-2">
                {OFFICE_ROOMS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setZoneId(r.id)}
                    className={`rounded-xl border px-3 py-2.5 text-right transition ${zoneId === r.id ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-border bg-card text-foreground hover:bg-muted'}`}
                  >
                    <div className="text-xs font-bold leading-none">{r.nameAr}</div>
                    <div className="mt-1 font-mono text-[10px] opacity-70">{r.code}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <span className="flex items-center gap-1 text-xs font-bold text-foreground">
                <Palette className="h-3.5 w-3.5 text-slate-500" />
                لون الشارة
              </span>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setAvatarColor(c)}
                    className={`h-8 w-8 rounded-full border-2 shadow-sm transition ${avatarColor === c ? 'scale-110 border-slate-900 dark:border-white' : 'border-white dark:border-white/10'}`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <span className="flex items-center gap-1 text-xs font-bold text-foreground">
                <Cpu className="h-3.5 w-3.5 text-slate-500" />
                المزود والموديل الابتدائي
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(BRAIN_MODELS) as BrainProvider[]).map((p) => {
                  const v = PROVIDER_VISUALS[p];
                  if (!v) return null;
                  const active = provider === p;
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        setProvider(p);
                        setModel(BRAIN_MODELS[p][0]!);
                      }}
                      className={`rounded-xl border px-3 py-2.5 text-right transition ${active ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30' : 'border-border bg-card hover:bg-muted'}`}
                    >
                      <div className="text-xs font-bold" style={{ color: v.color }}>{v.fullLabel}</div>
                      <div className="text-[11px] text-muted-foreground">{BRAIN_PROVIDER_LABELS[p]}</div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {models.map((m) => (
                  <button
                    key={m}
                    onClick={() => setModel(m)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition ${model === m ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-border bg-card text-foreground hover:bg-muted'}`}
                  >
                    <span className="font-mono text-xs font-bold" dir="ltr">{m}</span>
                    <span className="text-[10px] opacity-70">{formatShortModel(m)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              <span className="inline-flex items-center gap-1 font-bold"><Sparkles className="h-3.5 w-3.5" /> ما الذي سيحدث؟</span>
              <br />
              سيظهر الوكيل الجديد عند مدخل الاستقبال ثم يسير عبر الممرات إلى مكتبه في {OFFICE_ROOMS.find((r) => r.id === zoneId)?.nameAr}. يمكنك نقله لاحقاً لأي غرفة وتبديل موديله في أي لحظة.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3">
          <button onClick={() => setOpen(false)} className="rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-foreground hover:bg-muted">
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900"
          >
            <UserPlus className="h-3.5 w-3.5" />
            تأكيد التوظيف
          </button>
        </div>
      </div>
    </div>
  );
}
