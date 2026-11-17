import { ChevronLeft, ChevronRight, Plug2, Cpu, MapPin, Footprints, Copy, Eye, EyeOff, Layers3, Sparkles, Lightbulb, Wrench, ShieldCheck, LineChart, Coffee, Palette, Megaphone, ShoppingCart, UsersRound } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { OFFICE_ROOMS, ROOM_BY_ID, PROVIDER_VISUALS, formatShortModel } from '../office/layout.js';
import type { AgentParticipant } from '../types.js';
import { BrainProvider } from '../types.js';

function AgentCard({ agent, selected, onSelect, onSwap, onFocus }:{ agent:AgentParticipant; selected:boolean; onSelect:()=>void; onSwap:()=>void; onFocus:()=>void }){
  const loc=useWoraStore(s=>s.agentLocations[agent.id]);
  const brain=agent.brainConfig;
  const vis=brain ? (PROVIDER_VISUALS[brain.provider as BrainProvider] ?? PROVIDER_VISUALS[BrainProvider.Google]) : null;
  const room=agent.zoneId ? ROOM_BY_ID[agent.zoneId] : null;
  const walking=loc?.isWalking;
  return (
    <div onClick={onSelect} className={`group relative overflow-hidden rounded-[18px] border bg-white transition cursor-pointer ${selected?'border-[#CBA36B] shadow-[0_8px_24px_rgba(203,163,107,.18)]':'border-stone-200 hover:border-stone-300 hover:shadow-sm'}`}>
      <div className="absolute inset-x-0 top-0 h-1" style={{background: agent.profile.avatarColor}}/>
      <div className="p-3">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] text-sm font-black text-white shadow-sm" style={{background: agent.profile.avatarColor}}>
              <span className="font-display text-[15px]">{agent.displayName.slice(0,2).toUpperCase()}</span>
            </div>
            <span className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${walking?'bg-sky-500 animate-pulse': agent.lifecycleState==='RESPONDING'?'bg-emerald-500': agent.lifecycleState==='THINKING'?'bg-amber-400 animate-pulse':'bg-stone-300'}`}/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5"><span className="truncate font-display text-[13px] font-[800]">{agent.displayName}</span>{selected && <span className="h-1.5 w-1.5 rounded-full bg-[#CBA36B]"/>}</div>
            <div className="truncate text-[11px] font-semibold text-stone-500">{agent.profile.customRole}</div>
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-stone-600"><MapPin className="h-3 w-3 opacity-50"/>{loc ? loc.areaNameAr : room?.nameAr ?? 'الواحة'}{walking && loc?.targetRoomNameAr ? ` → ${loc.targetRoomNameAr}`:''}{walking && <Footprints className="h-3 w-3 text-sky-500 animate-pulse"/>}</div>
            {brain && vis && (
              <button onClick={e=>{e.stopPropagation(); onSwap();}} className="mt-2 flex w-full items-center gap-1.5 rounded-full border px-2 py-1 text-left" style={{background: vis.bgLight, borderColor: vis.border}}>
                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{background: vis.color}}>{vis.shortLabel.slice(0,2)}</span>
                <span className="flex-1 truncate text-[11px] font-bold" style={{color:vis.color}}>{vis.shortLabel}</span>
                <span className="font-mono text-[10px] font-semibold opacity-70" dir="ltr">{formatShortModel(brain.model)}</span>
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          <button onClick={e=>{e.stopPropagation(); onFocus();}} className="flex flex-1 items-center justify-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-1.5 text-[11px] font-bold hover:bg-white"><Eye className="h-3 w-3"/> متابعة</button>
          <button onClick={e=>{e.stopPropagation(); onSwap();}} className="flex flex-1 items-center justify-center gap-1 rounded-full bg-[#0B0F19] px-2 py-1.5 text-[11px] font-bold text-white"><Plug2 className="h-3 w-3"/> تبديل</button>
        </div>
      </div>
    </div>
  );
}
const ROOM_ICON: Record<string, typeof Layers3> = { 'zone-product': Lightbulb, 'zone-planning': Layers3, 'zone-boardroom': UsersRound, 'zone-engineering': Wrench, 'zone-design': Palette, 'zone-review': ShieldCheck, 'zone-marketing': Megaphone, 'zone-sales': ShoppingCart, 'zone-analytics': LineChart, 'zone-lounge': Coffee, };

export function CompanySidebar(){
  const show=useWoraStore(s=>s.ui.showSidebar), toggle=useWoraStore(s=>s.toggleSidebar);
  const agents=useWoraStore(s=>s.agents), selectedId=useWoraStore(s=>s.selectedAgentId), followId=useWoraStore(s=>s.followAgentId);
  const selectAgent=useWoraStore(s=>s.selectAgent), setFollow=useWoraStore(s=>s.setFollowAgent), openSwap=useWoraStore(s=>s.openModelSwap);
  const dispatch=useWoraStore(s=>s.dispatchAgentToRoom), focus=useWoraStore(s=>s.focusRoomCamera), roomId=useWoraStore(s=>s.roomId), activity=useWoraStore(s=>s.activityLog);
  const list=Object.values(agents).sort((a,b)=>a.displayName.localeCompare(b.displayName));
  if(!show) return <button onClick={toggle} className="absolute left-2 top-[64px] z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white shadow"><ChevronLeft className="h-4 w-4"/></button>;
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-stone-200 bg-[#FDFBF7]">
      <div className="flex h-[48px] items-center justify-between border-b border-stone-200 bg-white px-3">
        <div className="flex items-center gap-2 text-xs font-black"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0B0F19] text-white"><Layers3 className="h-4 w-4"/></span> أجنحة الواحة (10)</div>
        <button onClick={toggle} className="h-7 w-7 rounded-full border border-stone-200 bg-white flex items-center justify-center"><ChevronRight className="h-4 w-4"/></button>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-stone-200 bg-white px-3 py-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-bold text-stone-500">استكشف الأجنحة</span><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold">واحة وسطية + 5 أروقة</span></div>
          <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto hq-scroll pr-1">
            {OFFICE_ROOMS.map(r=>{ const Icon=ROOM_ICON[r.id]??Layers3; return <button key={r.id} onClick={()=>focus(r.id)} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-[#FDFBF7] px-2.5 py-2 hover:bg-white hover:border-[#CBA36B]/40 text-right"><span className="flex h-7 w-7 items-center justify-center rounded-lg text-white shrink-0" style={{background: r.accent}}><Icon className="h-3.5 w-3.5"/></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold">{r.nameAr}</span><span className="block truncate font-mono text-[10px] text-stone-500">{r.code}</span></span></button>; })}
          </div>
          <div className="mt-2 rounded-xl bg-gradient-to-l from-amber-50 to-orange-50 border border-amber-200 px-2.5 py-2 flex items-center gap-2 text-[11px] font-semibold text-amber-800"><Coffee className="h-4 w-4"/> الواحة تتوسط الأجنحة — الممرات مظللة بالأعمدة</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 hq-scroll space-y-3">
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold text-stone-500">المبدعون ({list.length})</span><span className="flex items-center gap-1 text-[10px] font-bold text-stone-500">{followId ? <Eye className="h-3 w-3 text-emerald-500"/> : <EyeOff className="h-3 w-3 opacity-40"/>}{followId?`تتابع ${agents[followId]?.displayName}`:'اختر من تتابع'}</span></div>
          <div className="flex flex-col gap-2.5">{list.map(ag=> <AgentCard key={ag.id} agent={ag} selected={selectedId===ag.id} onSelect={()=>selectAgent(selectedId===ag.id?null:ag.id)} onSwap={()=>openSwap(ag.id)} onFocus={()=>setFollow(followId===ag.id?null:ag.id)}/>)}</div>
          <div className="rounded-[16px] border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-xs font-bold"><Sparkles className="h-3.5 w-3.5 text-[#CBA36B]"/> حركة سريعة</div>
            <p className="mt-1 text-[11px] text-stone-500">اضغط جناحاً ليذهب الوكيل عبر الأروقة المظللة.</p>
            <div className="mt-2 grid grid-cols-2 gap-1">{OFFICE_ROOMS.slice(0,4).map(r=> <button key={r.id} onClick={()=>{ const tid=selectedId ?? list[0]?.id; if(tid) dispatch(tid,r.id); }} className="rounded-full border border-stone-200 bg-[#FDFBF7] px-2 py-1 text-[11px] font-bold hover:bg-white">→ {r.nameAr.split(' ')[0]}</button>)}</div>
          </div>
          <div className="space-y-1.5">{activity.slice(0,6).map(it=> <div key={it.id} className="flex gap-2 rounded-xl border border-stone-200 bg-white px-2.5 py-2"><span className="mt-1 h-2 w-2 rounded-full shrink-0" style={{background:it.color}}/><div className="min-w-0 flex-1"><div className="text-[11px] font-medium">{it.text}</div><div className="text-[10px] text-stone-500">{it.timestamp}</div></div></div>)}</div>
          <div className="rounded-xl bg-[#0B0F19] px-3 py-2.5 text-white"><div className="text-[10px] font-bold tracking-widest opacity-60">ROOM ID</div><div className="mt-1 flex items-center gap-2"><code className="flex-1 truncate font-mono text-xs font-bold" dir="ltr">{roomId}</code><button onClick={()=>navigator.clipboard.writeText(roomId)} className="h-7 w-7 rounded-full bg-white/15 flex items-center justify-center"><Copy className="h-3.5 w-3.5"/></button></div></div>
        </div>
      </div>
    </aside>
  );
}
