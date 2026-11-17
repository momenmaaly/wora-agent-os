import {
  ChevronLeft,
  ChevronRight,
  Plug2,
  Cpu,
  MapPin,
  Footprints,
  MessageCircle,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Layers3,
  Sparkles,
  UsersRound,
  Wrench,
  ShieldCheck,
  LineChart,
  Coffee,
} from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import {
  OFFICE_ROOMS,
  ROOM_BY_ID,
  PROVIDER_VISUALS,
  formatShortModel,
  getAgentHomeSpot,
} from '../office/layout.js';
import type { AgentParticipant } from '../types.js';
import { BRAIN_PROVIDER_LABELS, BrainProvider } from '../types.js';

function StatusDot({ state }: { state: string }) {
  const isThinking = state === 'THINKING' || state === 'REFINING' || state === 'EXECUTING' || state === 'EXECUTING_TOOL';
  const isTalking  = state === 'RESPONDING';
  const isError    = state === 'ERROR';
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        isError
          ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'
          : isTalking
            ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] animate-pulse'
            : isThinking
              ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,146,60,0.6)] animate-pulse'
              : 'bg-slate-300 dark:bg-slate-600'
      }`}
    />
  );
}

function AgentRow({
  agent,
  selected,
  onSelect,
  onSwap,
  onFocus,
  onRemove,
}: {
  agent: AgentParticipant;
  selected: boolean;
  onSelect: () => void;
  onSwap: () => void;
  onFocus: () => void;
  onRemove?: () => void;
}) {
  const loc   = useWoraStore((s) => s.agentLocations[agent.id]);
  const isSwappedRecent = useWoraStore((s) => {
    const ls = s.lastSwappedAgent;
    return ls !== null && ls.agentId === agent.id && Date.now() - ls.at < 1800;
  });
  const brain  = agent.brainConfig;
  const visual = brain ? PROVIDER_VISUALS[brain.provider as BrainProvider] ?? PROVIDER_VISUALS[BrainProvider.Google] : null;
  const room   = agent.zoneId ? ROOM_BY_ID[agent.zoneId] : null;

  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-pointer rounded-2xl border px-3 py-3 transition ${
        selected
          ? 'border-indigo-300 bg-indigo-50/80 shadow-sm dark:border-indigo-800 dark:bg-indigo-950/30'
          : 'border-border bg-card hover:border-indigo-200 hover:bg-muted/50 dark:hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[13px] font-bold text-white shadow-sm"
            style={{ background: agent.profile.avatarColor }}
          >
            {agent.displayName.slice(0, 2).toUpperCase()}
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-card shadow-sm">
            <StatusDot state={agent.lifecycleState} />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-bold leading-none text-foreground">{agent.displayName}</span>
            {agent.id.startsWith('agent-custom-') && (
              <span className="shrink-0 rounded-full bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white dark:bg-white dark:text-slate-900">
                جديد
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] font-medium leading-none text-muted-foreground">
            {agent.profile.customRole}
          </div>

          {/* Location */}
          <div className="mt-2 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">
              {loc ? loc.areaNameAr : room?.nameAr ?? 'المقر'}
              {loc?.isWalking && loc.targetRoomNameAr ? ` → ${loc.targetRoomNameAr}` : ''}
            </span>
            {loc?.isWalking && <Footprints className="h-3 w-3 shrink-0 animate-pulse text-indigo-500" />}
          </div>

          {/* Model chip — always visible, click to swap */}
          {brain && visual ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwap();
              }}
              className={`mt-2 flex w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left transition hover:brightness-[1.03] ${
                isSwappedRecent ? 'animate-model-flash' : ''
              }`}
              style={{
                background: visual.bgLight,
                borderColor: visual.border,
              }}
              title={`الموديل الحالي: ${brain.model} — انقر للتبديل`}
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: visual.color }}
              >
                {visual.shortLabel.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold leading-none" style={{ color: visual.color }}>
                {visual.shortLabel}
              </span>
              <span className="shrink-0 truncate text-right font-mono text-[10px] font-semibold leading-none text-foreground/80" dir="ltr">
                {formatShortModel(brain.model)}
              </span>
              <Cpu className="h-3 w-3 shrink-0 opacity-50" style={{ color: visual.color }} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Hover actions */}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-border bg-white px-2 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted dark:bg-white/5"
        >
          <Eye className="h-3 w-3" />
          متابعة
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSwap();
          }}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
        >
          <Plug2 className="h-3 w-3" />
          تبديل الموديل
        </button>
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-400"
            title="حذف الوكيل المخصص"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

const ROOM_ICON: Record<string, typeof Layers3> = {
  'zone-planning':   Layers3,
  'zone-boardroom':  UsersRound,
  'zone-engineering': Wrench,
  'zone-review':     ShieldCheck,
  'zone-lounge':     Coffee,
  'zone-analytics':  LineChart,
};

export function CompanySidebar() {
  const showSidebar     = useWoraStore((s) => s.ui.showSidebar);
  const toggleSidebar   = useWoraStore((s) => s.toggleSidebar);
  const agents          = useWoraStore((s) => s.agents);
  const selectedId      = useWoraStore((s) => s.selectedAgentId);
  const followId        = useWoraStore((s) => s.followAgentId);
  const selectAgent     = useWoraStore((s) => s.selectAgent);
  const setFollowAgent  = useWoraStore((s) => s.setFollowAgent);
  const openModelSwap   = useWoraStore((s) => s.openModelSwap);
  const removeCustom    = useWoraStore((s) => s.removeCustomAgent);
  const dispatchToRoom  = useWoraStore((s) => s.dispatchAgentToRoom);
  const focusRoomCamera = useWoraStore((s) => s.focusRoomCamera);
  const showWorkspaceHUD= useWoraStore((s) => s.ui.showWorkspaceHUD);
  const toggleWorkspace = useWoraStore((s) => s.toggleWorkspaceHUD);
  const toggleChat      = useWoraStore((s) => s.toggleChat);
  const showChat        = useWoraStore((s) => s.ui.showChat);
  const roomId          = useWoraStore((s) => s.roomId);
  const activityLog     = useWoraStore((s) => s.activityLog);

  const agentList = Object.values(agents).sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (!showSidebar) {
    return (
      <button
        onClick={toggleSidebar}
        className="absolute left-2 top-[64px] z-20 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card shadow-card"
        aria-label="فتح الشريط الجانبي"
      >
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
      </button>
    );
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border bg-surface shadow-sm">
      {/* Sidebar header */}
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-border bg-card px-3">
        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
          <Layers3 className="h-4 w-4 text-indigo-600" />
          أقسام الشركة
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleWorkspace()}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-muted-foreground transition ${showWorkspaceHUD ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-border bg-card hover:bg-muted'}`}
            title="لوحة مهام الأقسام"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => toggleChat()}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-muted-foreground transition ${showChat ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300' : 'border-border bg-card hover:bg-muted'}`}
            title="الدردشة"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggleSidebar}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted"
            aria-label="إخفاء الشريط"
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Room quick-jump */}
        <div className="border-b border-border bg-card/60 px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wide text-muted-foreground">الانتقال السريع للغرف</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{OFFICE_ROOMS.length} غرف · 3 ممرات</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {OFFICE_ROOMS.map((room) => {
              const Icon = ROOM_ICON[room.id] ?? Layers3;
              return (
                <button
                  key={room.id}
                  onClick={() => focusRoomCamera(room.id)}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2 text-right transition hover:border-indigo-200 hover:bg-indigo-50/50 dark:hover:bg-white/[0.04]"
                  title={room.nameAr}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: room.accent }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-bold leading-none text-foreground">{room.nameAr}</span>
                    <span className="block truncate font-mono text-[10px] font-semibold leading-none text-muted-foreground">{room.code}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            <Footprints className="h-3 w-3 shrink-0" />
            الوكلاء يسيرون على الممرات فقط — لا عبور للجدران
          </div>
        </div>

        {/* Agent roster */}
        <div className="flex-1 overflow-y-auto px-3 py-3 hq-scroll">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wide text-muted-foreground">فريق العمل ({agentList.length})</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
              {followId ? <Eye className="h-3 w-3 text-indigo-500" /> : <EyeOff className="h-3 w-3 opacity-50" />}
              {followId ? `متابعة ${agents[followId]?.displayName ?? ''}` : 'بدون متابعة'}
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {agentList.map((ag) => (
              <AgentRow
                key={ag.id}
                agent={ag}
                selected={selectedId === ag.id}
                onSelect={() => selectAgent(selectedId === ag.id ? null : ag.id)}
                onSwap={() => openModelSwap(ag.id)}
                onFocus={() => setFollowAgent(followId === ag.id ? null : ag.id)}
                onRemove={ag.id.startsWith('agent-custom-') ? () => removeCustom(ag.id) : undefined}
              />
            ))}
          </div>

          {/* Per-agent quick move */}
          <div className="mt-4 rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              تحريك سريع
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              اختر وكيلاً ثم وجّهه لأي غرفة — سيسير تلقائياً عبر الممرات والأبواب المفتوحة.
            </p>
            <div className="grid grid-cols-2 gap-1">
              {OFFICE_ROOMS.slice(0, 4).map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    const targetId = selectedId ?? agentList[0]?.id;
                    if (targetId) dispatchToRoom(targetId, r.id);
                  }}
                  disabled={!selectedId && agentList.length === 0}
                  className="rounded-full border border-border bg-white px-2 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted disabled:opacity-40 dark:bg-white/5"
                >
                  → {r.nameAr.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Activity feed */}
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground">سجل الحركة الحي</div>
            <div className="flex flex-col gap-1.5">
              {activityLog.slice(0, 10).map((item) => (
                <div
                  key={item.id}
                  className="flex gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium leading-snug text-foreground">{item.text}</div>
                    <div className="text-[10px] text-muted-foreground">{item.timestamp}</div>
                  </div>
                </div>
              ))}
              {activityLog.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  لا يوجد نشاط بعد
                </div>
              )}
            </div>
          </div>

          {/* Room ID */}
          <div className="mt-4 rounded-xl bg-slate-900 px-3 py-2.5 text-white dark:bg-white dark:text-slate-900">
            <div className="text-[10px] font-bold tracking-widest opacity-70">ROOM ID</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-xs font-bold" dir="ltr">
                {roomId}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(roomId)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 dark:bg-slate-900/10 dark:text-slate-900"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
