import { useMemo, useState } from 'react';
import {
  ClipboardList,
  Plus,
  Send,
  Layers3,
  ShieldCheck,
  Wrench,
  LineChart,
  Clock,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { OFFICE_ROOMS, ROOM_BY_ID } from '../office/layout.js';

const ZONE_ICON: Record<string, typeof Layers3> = {
  'zone-planning':   Layers3,
  'zone-engineering': Wrench,
  'zone-review':     ShieldCheck,
  'zone-analytics':  LineChart,
};

export function WorkspaceBoard() {
  const workspaces   = useWoraStore((s) => s.workspaces);
  const agents       = useWoraStore((s) => s.agents);
  const showHUD      = useWoraStore((s) => s.ui.showWorkspaceHUD);
  const toggleHUD    = useWoraStore((s) => s.toggleWorkspaceHUD);
  const { sendWorkspaceSignal } = useSocket();

  const [activeZone, setActiveZone] = useState<string>('zone-planning');
  const [title, setTitle] = useState('');

  const agentOptions = useMemo(
    () => Object.values(agents).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [agents],
  );
  const [assigneeId, setAssigneeId] = useState<string>(() => agentOptions[0]?.id ?? 'agent-planner-01');
  // keep assignee in sync when agents change (e.g., hire)
  const effectiveAssignee = agentOptions.find((a) => a.id === assigneeId)?.id ?? agentOptions[0]?.id ?? 'agent-planner-01';

  if (!showHUD) {
    return (
      <button
        onClick={() => toggleHUD()}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-bold text-foreground shadow-card"
      >
        <ClipboardList className="h-4 w-4 text-indigo-600" />
        مهام الأقسام
      </button>
    );
  }

  const ws = workspaces[activeZone];
  const entries = ws?.entries ?? [];
  const zoneRoom = ROOM_BY_ID[activeZone];

  return (
    <div className="pointer-events-auto flex max-h-[52vh] w-[min(560px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-office">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <ClipboardList className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-bold leading-none text-foreground">لوحة مهام الأقسام</div>
            <div className="text-[11px] font-medium text-muted-foreground">مهام مرتبطة بغرف المقر — وكل مهمة تحرّك الوكيل فعلياً عبر الممرات</div>
          </div>
        </div>
        <button
          onClick={() => toggleHUD()}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs font-bold text-foreground hover:bg-muted"
        >
          إخفاء
        </button>
      </div>

      {/* Zone tabs */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-2 hq-scroll">
        {OFFICE_ROOMS.filter((r) => r.isBackendZone).map((r) => {
          const Icon = ZONE_ICON[r.id] ?? Layers3;
          const active = activeZone === r.id;
          const count = workspaces[r.id]?.entries.length ?? 0;
          return (
            <button
              key={r.id}
              onClick={() => setActiveZone(r.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'border-border bg-white text-foreground hover:bg-muted dark:bg-white/5'}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: r.accent }}>
                <Icon className="h-3 w-3" />
              </span>
              {r.nameAr}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/15 text-white dark:bg-slate-900/10 dark:text-slate-900' : 'bg-muted text-muted-foreground'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-b border-border bg-muted/30 px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) {
                sendWorkspaceSignal(activeZone, effectiveAssignee, title.trim(), { source: 'hq-board' });
                setTitle('');
              }
            }}
            placeholder={`مهمة جديدة في ${zoneRoom?.nameAr ?? activeZone}…`}
            className="h-9 flex-1 rounded-full border border-border bg-white px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:bg-white/5 dark:focus:ring-indigo-900/20"
          />
          <select
            value={effectiveAssignee}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="h-9 max-w-[140px] rounded-full border border-border bg-white px-3 text-xs font-bold text-foreground outline-none dark:bg-white/5"
          >
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!title.trim()) return;
              sendWorkspaceSignal(activeZone, effectiveAssignee, title.trim(), { source: 'hq-board' });
              setTitle('');
            }}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
            title="إضافة المهمة"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3 text-violet-500" />
          عند إضافة مهمة سيتجه الوكيل المسؤول تلقائياً عبر الممرات إلى غرفة القسم.
        </div>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto px-3 py-3 hq-scroll">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
            <Layers3 className="h-6 w-6 text-muted-foreground/50" />
            <div className="text-sm font-bold text-foreground">لا توجد مهام في {zoneRoom?.nameAr}</div>
            <div className="text-xs text-muted-foreground">أضف أول مهمة وسيتحرك الفريق فوراً.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries
              .slice()
              .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
              .map((e) => {
                const author = agents[e.authorAgentId];
                const isDone = e.status === 'approved' || e.status === 'done';
                return (
                  <div key={e.id} className="rounded-2xl border border-border bg-card px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold leading-snug text-foreground">{e.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${isDone ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300'}`}>
                            {isDone ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                            {isDone ? 'مكتملة' : 'قيد التنفيذ'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Plus className="h-3 w-3 opacity-50" />
                            {author ? `${author.displayName} · ${author.brainConfig?.model ?? author.modelId}` : e.authorAgentId}
                          </span>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground">{e.type}</span>
                    </div>
                    {Object.keys(e.payload ?? {}).length > 0 && (
                      <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {Object.entries(e.payload as Record<string, unknown>)
                          .slice(0, 3)
                          .map(([k, v]) => (
                            <div key={k} className="truncate">
                              <span className="font-bold">{k}:</span> {String(v).slice(0, 80)}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
