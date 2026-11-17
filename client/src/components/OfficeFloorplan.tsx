import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Footprints, Eye, Move, Crosshair, Sparkles, Coffee, UsersRound } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { WORLD_WIDTH, WORLD_HEIGHT, OFFICE_ROOMS, CORRIDORS, ROOM_SPOTS, getAgentHomeSpot, computeOfficePath, locatePoint, PROVIDER_VISUALS, formatShortModel } from '../office/layout.js';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { BrainProvider } from '../types.js';

// ── soul palette ──
const SA = {
  sand:'#FDF6E3', sand2:'#F5E6CC', dune:'#E8DCC6', line:'#E0D0B8',
  ink:'#0B0F19', brass:'#CBA36B', teal:'#2A9D8F', terracotta:'#C87941',
  palm:'#3A7D5C', water:'#7EC8C0',
};
const ROOM_SOUL: Record<string,{roof:string; wall:string; accent:string; patio:string; pattern:string}> = {
  'zone-product':   { roof:'#CBA36B', wall:'#FFF8EC', accent:'#C87941', patio:'#FEF3C7', pattern:'mashrabiya' },
  'zone-planning':  { roof:'#4A5568', wall:'#F7F5FF', accent:'#6366F1', patio:'#E0E7FF', pattern:'grid' },
  'zone-boardroom': { roof:'#0B0F19', wall:'#FFFBF0', accent:'#CBA36B', patio:'#FEF3C7', pattern:'arch' },
  'zone-engineering':{ roof:'#1E3A5F', wall:'#F0F8FF', accent:'#0EA5E9', patio:'#DBEAFE', pattern:'code' },
  'zone-design':    { roof:'#9D174D', wall:'#FFF0F7', accent:'#EC4899', patio:'#FCE7F3', pattern:'dots' },
  'zone-review':    { roof:'#7C2D12', wall:'#FFF7ED', accent:'#EA580C', patio:'#FFEDD5', pattern:'shield' },
  'zone-lounge':    { roof:'#14532D', wall:'#F0FDF4', accent:'#2A9D8F', patio:'#D1FAE5', pattern:'palm' },
  'zone-marketing': { roof:'#0E7490', wall:'#ECFEFF', accent:'#0891B2', patio:'#CFFAFE', pattern:'wave' },
  'zone-sales':     { roof:'#6D28D9', wall:'#F5F3FF', accent:'#7C3AED', patio:'#EDE9FE', pattern:'diamond' },
  'zone-analytics': { roof:'#064E3B', wall:'#ECFDF5', accent:'#059669', patio:'#D1FAE5', pattern:'chart' },
};

// ── movable logic (unchanged core) ──
interface MovableAgent { id:string; x:number; y:number; path:{x:number;y:number}[]; isWalking:boolean; facing:number; }
const AGENT_SPEED=135, USER_SPEED=155, AUTO_MIN=5500, AUTO_MAX=11000;

export function OfficeFloorplan(){
  const agents = useWoraStore(s=>s.agents);
  const selectedId = useWoraStore(s=>s.selectedAgentId);
  const followId = useWoraStore(s=>s.followAgentId);
  const selectAgent = useWoraStore(s=>s.selectAgent);
  const setFollowAgent = useWoraStore(s=>s.setFollowAgent);
  const theme = useWoraStore(s=>s.ui.theme);
  const isDark = theme==='dark';
  const plan = useBillingStore(s=>s.plan);

  // camera
  const [scale,setScale]=useState(0.72);
  const [pan,setPan]=useState({x:0,y:0});
  const containerRef=useRef<HTMLDivElement>(null);
  const svgRef=useRef<SVGSVGElement>(null);
  const isPanning=useRef(false);
  const panStart=useRef<{x:number;y:number;panX:number;panY:number}|null>(null);

  // movables
  const [movables,setMovables]=useState<Record<string,MovableAgent>>(()=>{
    const m:Record<string,MovableAgent>={};
    Object.values(agents).forEach((a,i)=>{
      const spot=getAgentHomeSpot(a,i);
      m[a.id]={id:a.id,x:spot.x,y:spot.y,path:[],isWalking:false,facing:0};
    });
    return m;
  });
  const [userPos,setUserPos]=useState({x:1000,y:440});
  const [userPath,setUserPath]=useState<{x:number;y:number}[]>([]);
  const [userFacing,setUserFacing]=useState(0);

  // sync new agents
  useEffect(()=>{
    setMovables(prev=>{
      const n={...prev};
      Object.values(agents).forEach((a,i)=>{
        if(!n[a.id]){ const spot=getAgentHomeSpot(a,i); n[a.id]={id:a.id,x:spot.x,y:spot.y,path:[],isWalking:false,facing:0};}
      });
      return n;
    });
  },[agents]);

  // movement tick
  useEffect(()=>{
    let raf=0; let last=performance.now();
    const tick=(now:number)=>{
      const dt=(now-last)/1000; last=now;
      setMovables(prev=>{
        const next={...prev};
        for(const id of Object.keys(next)){
          const m=next[id]!; if(m.path.length===0) continue;
          const target=m.path[0]!; const dx=target.x-m.x, dy=target.y-m.y; const dist=Math.hypot(dx,dy);
          const step=AGENT_SPEED*dt;
          if(dist<=step){ m.x=target.x; m.y=target.y; m.path=m.path.slice(1); m.facing=Math.atan2(dy,dx)*180/Math.PI; if(m.path.length===0) m.isWalking=false;
          } else { m.x+=dx/dist*step; m.y+=dy/dist*step; m.facing=Math.atan2(dy,dx)*180/Math.PI; m.isWalking=true; }
        }
        return {...next};
      });
      if(userPath.length>0){
        const target=userPath[0]!; const dx=target.x-userPos.x, dy=target.y-userPos.y; const dist=Math.hypot(dx,dy); const step=USER_SPEED*( (performance.now()-last)/1000 + dt);
        if(dist<=step){ setUserPos({x:target.x,y:target.y}); setUserPath(p=>p.slice(1)); if(Math.hypot(dx,dy)>1) setUserFacing(Math.atan2(dy,dx)*180/Math.PI);
        } else { setUserPos(p=>({x:p.x+dx/dist*USER_SPEED*dt, y:p.y+dy/dist*USER_SPEED*dt})); setUserFacing(Math.atan2(dy,dx)*180/Math.PI); }
      }
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick); return ()=>cancelAnimationFrame(raf);
  },[userPath,userPos]);

  // auto roam
  useEffect(()=>{
    const t=setInterval(()=>{
      const ids=Object.keys(agents); if(ids.length===0) return;
      const id=ids[Math.floor(Math.random()*ids.length)]!;
      const rooms=OFFICE_ROOMS; const r=rooms[Math.floor(Math.random()*rooms.length)]!;
      const spots=ROOM_SPOTS.filter(s=>s.roomId===r.id); const spot=spots[Math.floor(Math.random()*spots.length)] ?? spots[0];
      if(!spot) return;
      const m=movables[id]; if(!m || m.isWalking) return;
      const path=computeOfficePath({x:m.x,y:m.y}, spot.id);
      if(path.length>0) setMovables(prev=>({...prev,[id]:{...prev[id]!,path,isWalking:true}}));
    }, 4000);
    return ()=>clearInterval(t);
  },[agents,movables]);

  const viewBox=useMemo(()=>{
    const vbW=WORLD_WIDTH/scale, vbH=WORLD_HEIGHT/scale;
    const cx=WORLD_WIDTH/2 - pan.x, cy=WORLD_HEIGHT/2 - pan.y;
    return `${cx - vbW/2} ${cy - vbH/2} ${vbW} ${vbH}`;
  },[scale,pan]);

  const zoomIn=()=>setScale(s=>Math.min(1.6,s*1.2));
  const zoomOut=()=>setScale(s=>Math.max(0.45,s/1.2));
  const resetView=()=>{ setScale(0.72); setPan({x:0,y:0}); };

  const onPointerDown=(e:React.PointerEvent)=>{ if(e.shiftKey || e.button===1){ isPanning.current=true; panStart.current={x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y}; }};
  const onPointerMove=(e:React.PointerEvent)=>{ if(!isPanning.current||!panStart.current) return; const dx=(e.clientX-panStart.current.x)/scale, dy=(e.clientY-panStart.current.y)/scale; setPan({x:panStart.current.panX+dx,y:panStart.current.panY+dy}); };
  const onPointerUp=()=>{ isPanning.current=false; panStart.current=null; };

  const handleFloorClick=(e:React.MouseEvent<SVGSVGElement>)=>{
    if(!svgRef.current) return;
    const pt=svgRef.current.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
    const ctm=svgRef.current.getScreenCTM()?.inverse(); if(!ctm) return;
    const p=pt.matrixTransform(ctm);
    const path=computeOfficePath(userPos, {x:p.x,y:p.y});
    if(path.length>0) setUserPath(path);
  };

  // follow camera
  useEffect(()=>{
    if(!followId) return;
    const m=movables[followId]; if(!m) return;
    setPan({x: m.x - WORLD_WIDTH/2, y: m.y - WORLD_HEIGHT/2});
  },[followId,movables]);

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col overflow-hidden bg-[#FDF6E3] dark:bg-[#0B0F19]">
      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-stone-200 bg-white/90 px-1 py-1 shadow-sm backdrop-blur">
          <button onClick={zoomOut} className="h-7 w-7 rounded-full hover:bg-stone-100 flex items-center justify-center"><ZoomOut className="h-4 w-4"/></button>
          <span className="min-w-[3rem] text-center font-mono text-xs font-bold">{Math.round(scale*100)}%</span>
          <button onClick={zoomIn} className="h-7 w-7 rounded-full hover:bg-stone-100 flex items-center justify-center"><ZoomIn className="h-4 w-4"/></button>
          <span className="mx-1 h-4 w-px bg-stone-200"/>
          <button onClick={resetView} className="h-7 w-7 rounded-full hover:bg-stone-100 flex items-center justify-center"><Maximize2 className="h-4 w-4"/></button>
        </div>
        <div className="pointer-events-auto hidden sm:flex items-center gap-1.5">
          <span className="rounded-full border border-stone-200 bg-white/90 px-2.5 py-1 text-[11px] font-bold backdrop-blur flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/> واحة وسط الصحراء — 10 أجنحة · {Object.keys(agents).length} مبدع</span>
          {followId && <button onClick={()=>setFollowAgent(null)} className="rounded-full bg-[#0B0F19] px-3 py-1 text-xs font-bold text-white flex items-center gap-1"><Eye className="h-3.5 w-3.5"/> إلغاء المتابعة</button>}
        </div>
      </div>

      <div className="flex-1 overflow-hidden" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{cursor: isPanning.current?'grabbing':'default'}}>
        <svg ref={svgRef} viewBox={viewBox} className="h-full w-full select-none" onClick={handleFloorClick} style={{background: isDark ? '#0B0F19' : SA.sand}}>
          <defs>
            <radialGradient id="duneGrad" cx="50%" cy="35%" r="75%"><stop offset="0%" stopColor={isDark?'#1A1F2E':'#FFF8E7'} /><stop offset="50%" stopColor={isDark?'#131825':'#FDF6E3'} /><stop offset="100%" stopColor={isDark?'#0B0F19':'#F5E6CC'} /></radialGradient>
            <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="6" stdDeviation="8" floodOpacity={isDark?0.35:0.12}/></filter>
            <pattern id="sandGrain" width="60" height="60" patternUnits="userSpaceOnUse"><circle cx="8" cy="12" r="0.6" fill={SA.dune} opacity="0.35"/><circle cx="30" cy="22" r="0.5" fill={SA.dune} opacity="0.25"/><circle cx="52" cy="45" r="0.7" fill={SA.dune} opacity="0.3"/></pattern>
          </defs>

          {/* dunes base */}
          <rect x={0} y={0} width={WORLD_WIDTH} height={WORLD_HEIGHT} rx={20} fill="url(#duneGrad)" />
          <rect x={0} y={0} width={WORLD_WIDTH} height={WORLD_HEIGHT} rx={20} fill="url(#sandGrain)" opacity={isDark?0.08:0.5} />

          {/* central oasis garden — the soul */}
          <g filter="url(#softShadow)">
            <ellipse cx={1000} cy={520} rx={280} ry={170} fill={isDark?'#0F1A14':'#E6F4EA'} stroke={isDark?'#1E3A2A':'#A7D8C8'} strokeWidth={2} />
            <ellipse cx={1000} cy={528} rx={250} ry={145} fill={isDark?'#14261E':'#D1EFE6'} />
            {/* water */}
            <ellipse cx={1000} cy={545} rx={92} ry={52} fill={SA.water} opacity={isDark?0.25:0.35} />
            <ellipse cx={1000} cy={548} rx={76} ry={38} fill={SA.water} opacity={0.55} />
            {/* shimmer */}
            <path d="M 940 548 Q 1000 540 1060 548" stroke="white" strokeWidth={1.2} opacity={0.6} fill="none" strokeLinecap="round">
              <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.2s" repeatCount="indefinite"/>
            </path>
            {/* palms */}
            {[
              {x:860,y:485, s:1},{x:1140,y:475,s:1.05},{x:880,y:585,s:0.9},{x:1120,y:590,s:0.92},{x:1000,y:430,s:1},
            ].map((p,i)=>(
              <g key={i} transform={`translate(${p.x},${p.y}) scale(${p.s})`}>
                <rect x={-2.5} y={-10} width={5} height={22} rx={2.5} fill="#8B5A2B"/>
                <g fill={SA.palm} opacity={0.95}>
                  <ellipse cx={-10} cy={-12} rx={10} ry={4} transform="rotate(-18)"/>
                  <ellipse cx={10} cy={-12} rx={10} ry={4} transform="rotate(18)"/>
                  <ellipse cx={0} cy={-16} rx={7} ry={10}/>
                </g>
              </g>
            ))}
            {/* benches around */}
            <rect x={970} y={500} width={60} height={6} rx={3} fill="#5C4A32" opacity={0.7}/>
            <text x={1000} y={455} textAnchor="middle" fontSize={7} fontWeight={800} fill={isDark?'#6B8F7A':'#2D5A3D'} letterSpacing={1.5}>واحة ورا</text>
          </g>

          {/* arcade corridors — shaded with columns */}
          {Object.values(CORRIDORS).map(c=>{
            const isH = c.width > c.height;
            return (
              <g key={c.id}>
                <rect x={c.x} y={c.y} width={c.width} height={c.height} rx={12} fill={isDark?'#1C2130':'white'} stroke={isDark?'#2A3042':'#E8DDC8'} strokeWidth={1.2} filter="url(#softShadow)"/>
                {/* columns */}
                {Array.from({length: isH ? Math.floor(c.width/80) : Math.floor(c.height/80)}).map((_,i)=>{
                  const px = isH ? c.x + 40 + i*80 : c.x + c.width/2;
                  const py = isH ? c.y + c.height/2 : c.y + 40 + i*80;
                  return <g key={i}><rect x={px-3} y={py-10} width={6} height={20} rx={3} fill={isDark?'#2A3042':'#F5E6CC'} stroke={isDark?'#3A4155':'#E0D0B8'} strokeWidth={0.8}/><circle cx={px} cy={py-12} r={2.5} fill={SA.brass} opacity={0.6}/></g>;
                })}
                <text x={c.x + c.width/2} y={c.y + c.height/2 + 3} textAnchor="middle" fontSize={7.5} fontWeight={700} letterSpacing={1.5} fill={isDark?'#4A5568':'#A09078'} opacity={0.65}>{c.nameEn}</text>
              </g>
            );
          })}

          {/* rooms — each is NOT a stamp: unique footprint */}
          {OFFICE_ROOMS.map(room=>{
            const soul = ROOM_SOUL[room.id] ?? ROOM_SOUL['zone-planning']!;
            const isSel = selectedId ? (agents[selectedId]?.zoneId===room.id) : false;
            const locked = isRoomLockedForPlan(room.id, plan);
            // per-room visual quirks to break the template
            const quirks: Record<string,{rx:number; roofH:number; notch?:string}> = {
              'zone-product':   {rx:18, roofH:26},
              'zone-planning':  {rx:10, roofH:20},
              'zone-boardroom': {rx:22, roofH:28, notch:'octa'},
              'zone-engineering':{rx:8, roofH:22},
              'zone-design':    {rx:16, roofH:24, notch:'skylight'},
              'zone-review':    {rx:12, roofH:22},
              'zone-lounge':    {rx:20, roofH:18},
              'zone-marketing': {rx:14, roofH:24},
              'zone-sales':     {rx:10, roofH:20},
              'zone-analytics': {rx:16, roofH:26, notch:'glass'},
            };
            const q = quirks[room.id] ?? {rx:16, roofH:22};
            return (
              <g key={room.id} filter="url(#softShadow)" opacity={locked?0.92:1}>
                {/* shadow */}
                <rect x={room.x+3} y={room.y+4} width={room.width} height={room.height} rx={q.rx} fill="black" opacity={isDark?0.35:0.08}/>
                {/* walls — unique */}
                <rect x={room.x} y={room.y} width={room.width} height={room.height} rx={q.rx} fill={isDark ? '#1A1F2E' : soul.wall} stroke={isSel ? soul.accent : locked ? '#CBA36B' : (isDark?'#2A3042':'#E8DDC8')} strokeWidth={isSel?2.4: locked?1.6:1.1} strokeDasharray={locked?'6 4':undefined}/>
                {locked && <rect x={room.x} y={room.y} width={room.width} height={room.height} rx={q.rx} fill="transparent" style={{cursor:'pointer'}} />}
                {/* roof band — varied height */}
                <rect x={room.x} y={room.y} width={room.width} height={q.roofH} rx={q.roofH/2} fill={soul.roof} opacity={locked?0.55:0.95}/>
                {/* pro crown for premium rooms */}
                {locked && <g transform={`translate(${room.x+room.width-10},${room.y+8})`}><circle r={7} fill="#CBA36B" stroke="white" strokeWidth={1}/><text textAnchor="middle" dy={2.5} fontSize={6} fontWeight={900} fill="white">♛</text></g>}
                {q.notch==='octa' && <path d={`M ${room.x+16} ${room.y+room.height} L ${room.x+32} ${room.y+room.height-12} L ${room.x+room.width-32} ${room.y+room.height-12} L ${room.x+room.width-16} ${room.y+room.height}`} fill={soul.patio} opacity={0.6}/>}
                {q.notch==='skylight' && <rect x={room.x+room.width/2-20} y={room.y+4} width={40} height={6} rx={3} fill="white" opacity={0.45}/>}
                {q.notch==='glass' && <rect x={room.x+room.width-14} y={room.y+30} width={8} height={room.height-50} rx={4} fill={soul.accent} opacity={0.12}/>}
                <text x={room.x+12} y={room.y+14} fontSize={7} fontWeight={800} fill="white" letterSpacing={0.6}>{room.code}</text>
                <text x={room.x+42} y={room.y+14} fontSize={9} fontWeight={800} fill="white">{room.nameAr}</text>
                {locked && <text x={room.x+room.width/2} y={room.y+ q.roofH + 14} textAnchor="middle" fontSize={7} fontWeight={800} fill="#92400E">Pro — مقفل</text>}
                {/* patio rug — varied */}
                <rect x={room.x+10} y={room.y+ q.roofH + 6} width={room.width-20} height={room.height - q.roofH - 16} rx={10} fill={soul.patio} opacity={isDark?0.5: locked?0.35:0.85}/>
                <text x={room.x+room.width-14} y={room.y+40} textAnchor="end" fontSize={16} opacity={isDark?0.18: locked?0.06:0.12}>{soul.pattern==='mashrabiya'?'◈':soul.pattern==='palm'?'🌴':soul.pattern==='code'?'⬢':'·'}</text>
                {locked && <g opacity={0.92}><rect x={room.x+10} y={room.y+ q.roofH + 22} width={room.width-20} height={room.height - q.roofH - 32} rx={10} fill="white" opacity={0.72}/><text x={room.x+room.width/2} y={room.y+ room.height/2 + 6} textAnchor="middle" fontSize={8} fontWeight={800} fill="#78350F">🔒 اضغط للترقية</text></g>}

                {/* doors as arches */}
                {room.doors.map(d=>{
                  const isH=d.wall==='north'||d.wall==='south';
                  const cx=isH ? (d.from+d.to)/2 : (d.wall==='west'? room.x : room.x+room.width);
                  const cy=!isH ? (d.from+d.to)/2 : (d.wall==='north'? room.y : room.y+room.height);
                  return <g key={d.id}><rect x={isH? d.from: cx-5} y={!isH? d.from: cy-5} width={isH? d.to-d.from:10} height={!isH? d.to-d.from:10} rx={4} fill={isDark?'#0F141F':'#FFF8EC'} stroke={soul.accent} strokeWidth={1} opacity={0.95}/><path d={isH? `M ${d.from+4} ${cy} A 8 8 0 0 1 ${d.to-4} ${cy}` : `M ${cx} ${d.from+4} A 8 8 0 0 1 ${cx} ${d.to-4}`} stroke={soul.accent} fill="none" strokeWidth={0.8} opacity={0.5}/></g>;
                })}

                {/* furniture with chairs — soulful */}
                {ROOM_SPOTS.filter(s=>s.roomId===room.id).map(spot=>{
                  const isDesk=spot.role==='desk'||spot.role==='desk-alt';
                  const isMeet=spot.role==='meeting';
                  const isCollab=spot.role==='collab';
                  const isCoffee=spot.role==='coffee';
                  const occupant = Object.values(agents).find(a=> a.zoneId===room.id && !useWoraStore.getState().agentLocations[a.id]?.isWalking);
                  const occupied = !!occupant;
                  // simple heuristic: first desk occupied if room has occupant
                  const deskOccupied = isDesk && occupied;
                  return (
                    <g key={spot.id} onClick={e=>{ e.stopPropagation(); if(occupant) selectAgent(occupant.id); }} style={{cursor: occupant ? 'pointer': 'default'}}>
                      {isDesk && (
                        <>
                          <rect x={spot.x-26} y={spot.y-14} width={52} height={28} rx={8} fill={isDark?'#232837':'white'} stroke={isDark?'#2A3042':'#E8DDC8'} strokeWidth={1}/>
                          <rect x={spot.x-26} y={spot.y-14} width={52} height={3.5} rx={2} fill={soul.accent} opacity={0.85}/>
                          <rect x={spot.x-8} y={spot.y-6} width={18} height={10} rx={2} fill={isDark?'#0F141F':'#F8FAFC'} stroke={deskOccupied? soul.accent: (isDark?'#2A3042':'#E8DDC8')} strokeWidth={deskOccupied?1.2:0.7}/>
                          {deskOccupied && <rect x={spot.x-6} y={spot.y-4} width={14} height={5} rx={1} fill={soul.accent} opacity={0.18}/>}
                          {/* chair with soul */}
                          <g transform={`translate(${spot.x},${spot.y+16})`}>
                            <ellipse cx={0} cy={2.5} rx={10} ry={3} fill="black" opacity={isDark?0.32:0.08}/>
                            <rect x={-9} y={-5} width={18} height={8} rx={4} fill={occupied? (occupant!.profile.avatarColor): (isDark?'#2A3042':'#EDE6D6')} stroke={deskOccupied?'white':'none'} strokeWidth={deskOccupied?1.1:0}/>
                            <rect x={-6} y={-9} width={12} height={5} rx={2.5} fill={occupied? (occupant!.profile.avatarColor): (isDark?'#2A3042':'#EDE6D6')} opacity={0.95}/>
                            {deskOccupied && <circle cx={0} cy={-1.5} r={1.6} fill="white" opacity={0.9}/>}
                          </g>
                          <circle cx={spot.x+14} cy={spot.y-2} r={2.8} fill="white" stroke={soul.accent} strokeWidth={0.7}/>
                        </>
                      )}
                      {isMeet && (
                        <>
                          <rect x={spot.x-16} y={spot.y-10} width={32} height={20} rx={8} fill={isDark?'#232837':'white'} stroke={isDark?'#2A3042':'#E8DDC8'}/>
                          <circle cx={spot.x} cy={spot.y} r={4} fill={soul.accent} opacity={0.12}/>
                          {[0,1,2,3,4,5].map(k=>{ const ang=(k*60-30)*Math.PI/180, r=14; return <circle key={k} cx={spot.x+Math.cos(ang)*r} cy={spot.y+Math.sin(ang)*r*0.6} r={3} fill={isDark?'#2A3042':'#F5E6CC'} stroke={soul.accent} strokeWidth={0.5} opacity={0.9}/>; })}
                        </>
                      )}
                      {isCollab && <><rect x={spot.x-20} y={spot.y-12} width={40} height={24} rx={8} fill={isDark?'#232837':'white'} stroke={isDark?'#2A3042':'#E8DDC8'}/><rect x={spot.x-12} y={spot.y-2} width={24} height={5} rx={2} fill={soul.accent} opacity={0.1}/></>}
                      {isCoffee && <><rect x={spot.x-18} y={spot.y-12} width={36} height={24} rx={8} fill={isDark?'#1A2A22':'white'} stroke={isDark?'#2A3A2E':'#E8DDC8'}/><rect x={spot.x-7} y={spot.y-6} width={14} height={12} rx={2.5} fill="#6F4E37"/><circle cx={spot.x} cy={spot.y-12} r={3} fill={soul.accent} opacity={0.2}/></>}
                      {(spot.role==='lounge') && <><rect x={spot.x-18} y={spot.y-8} width={36} height={16} rx={8} fill={soul.accent} opacity={0.12} stroke={soul.accent} strokeWidth={0.8}/><circle cx={spot.x} cy={spot.y} r={5} fill={soul.accent} opacity={0.18}/></>}
                      {(spot.role==='board') && <><rect x={spot.x-16} y={spot.y-10} width={32} height={20} rx={6} fill={isDark?'#232837':'white'} stroke={isDark?'#2A3042':'#E8DDC8'}/><rect x={spot.x-8} y={spot.y-4} width={16} height={9} rx={1.5} fill={soul.accent} opacity={0.16}/></>}
                      {(spot.role as string)==='showcase' && <><rect x={spot.x-16} y={spot.y-8} width={32} height={16} rx={4} fill={isDark?'#232837':'white'} stroke={soul.accent} strokeWidth={1}/><text x={spot.x} y={spot.y+2} textAnchor="middle" fontSize={5.5} fontWeight={800} fill={soul.accent}>SHOW</text></>}
                      {(spot.role as string)==='stage' && <><rect x={spot.x-22} y={spot.y-6} width={44} height={12} rx={6} fill={soul.accent} opacity={0.15} stroke={soul.accent}/><text x={spot.x} y={spot.y+2} textAnchor="middle" fontSize={5.5} fontWeight={800} fill={soul.accent}>STAGE</text></>}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* trails */}
          {Object.values(movables).map(m=>{
            if(m.path.length===0) return null;
            const all=[{x:m.x,y:m.y},...m.path]; const d=all.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
            const accent=agents[m.id]?.profile.avatarColor ?? SA.brass;
            return <g key={`trail-${m.id}`}><path d={d} fill="none" stroke={accent} strokeWidth={2.8} strokeDasharray="7 7" opacity={0.35} className="animate-route-dash"/><path d={d} fill="none" stroke="white" strokeWidth={0.9} strokeDasharray="7 7" opacity={0.6} className="animate-route-dash"/></g>;
          })}

          {/* user */}
          <g transform={`translate(${userPos.x},${userPos.y})`}>
            <ellipse cx={0} cy={11} rx={12} ry={4} fill="black" opacity={isDark?0.28:0.1}/>
            <g transform={`rotate(${userFacing} 0 0)`}>
              <rect x={-10} y={-8} width={20} height={16} rx={6} fill="#0EA5E9" stroke="white" strokeWidth={1.4}/>
              <circle cx={0} cy={-10} r={8} fill="#0EA5E9" stroke="white" strokeWidth={1.4}/>
              <text x={0} y={-6.5} textAnchor="middle" fontSize={7} fontWeight={800} fill="white">YOU</text>
              <polygon points="8,-1 12,0 8,1.5" fill="#0EA5E9" stroke="white" strokeWidth={0.7}/>
            </g>
            <rect x={-20} y={-26} width={40} height={11} rx={5} fill={isDark?'#0F141F':'white'} stroke="#0EA5E9" strokeWidth={1}/><text x={0} y={-18.5} textAnchor="middle" fontSize={6.5} fontWeight={800} fill={isDark?'white':'#0F172A'}>أنت</text>
          </g>

          {/* agents — illustrated characters */}
          {Object.values(agents).map(ag=>{
            const m=movables[ag.id]; if(!m) return null;
            const brain=ag.brainConfig; const vis=brain ? (PROVIDER_VISUALS[brain.provider as BrainProvider] ?? PROVIDER_VISUALS[BrainProvider.Google]) : null;
            const isSel=selectedId===ag.id; const isFollow=followId===ag.id;
            const thinking=ag.lifecycleState==='THINKING'||ag.lifecycleState==='REFINING'||ag.lifecycleState==='EXECUTING';
            const talking=ag.lifecycleState==='RESPONDING';
            const walking=m.isWalking;
            return (
              <g key={ag.id} transform={`translate(${m.x},${m.y})`} onClick={e=>{ e.stopPropagation(); selectAgent(ag.id); }} style={{cursor:'pointer'}}>
                <ellipse cx={0} cy={13} rx={13} ry={4.2} fill="black" opacity={isDark?0.32:0.12}/>
                {/* selection halo */}
                {isSel && <circle cx={0} cy={0} r={18} fill="none" stroke={ag.profile.avatarColor} strokeWidth={1.4} opacity={0.5} strokeDasharray="4 3"/>}
                {/* body — thobe/abaya inspired shape */}
                <g transform={`rotate(${walking ? m.facing*0.12 : 0} 0 0)`}>
                  <path d="M -9 2 L -7 -8 L 7 -8 L 9 2 L 4 6 L -4 6 Z" fill={ag.profile.avatarColor} stroke="white" strokeWidth={1.3}/>
                  {/* sash */}
                  <rect x={-1.5} y={-6} width={3} height={10} rx={1.5} fill="white" opacity={0.9}/>
                  <circle cx={0} cy={-10} r={7.5} fill={ag.profile.avatarColor} stroke="white" strokeWidth={1.3}/>
                  <text x={0} y={-7} textAnchor="middle" fontSize={6} fontWeight={900} fill="white">{ag.displayName.slice(0,2).toUpperCase()}</text>
                  {/* walking legs */}
                  {walking && <><ellipse cx={-3} cy={7} rx={2.5} ry={1.8} fill={ag.profile.avatarColor} opacity={0.6}/><ellipse cx={3} cy={7} rx={2.5} ry={1.8} fill={ag.profile.avatarColor} opacity={0.6}/></>}
                </g>
                {/* nameplate editorial */}
                <g>
                  <rect x={-28} y={-28} width={56} height={13} rx={6} fill={isDark?'#0F141F':'white'} stroke={isSel? ag.profile.avatarColor : (isDark?'#2A3042':'#E8DDC8')} strokeWidth={isSel?1.2:0.8}/>
                  <text x={0} y={-19.5} textAnchor="middle" fontSize={7} fontWeight={800} fill={isDark?'white':'#0B0F19'}>{ag.displayName}</text>
                  {vis && <circle cx={18} cy={-21.5} r={3.2} fill={vis.color}/>}
                </g>
                {/* status bubble */}
                {(thinking || talking || walking) && (
                  <g transform="translate(14,-34)">
                    <rect x={-10} y={-6} width={20} height={10} rx={5} fill={walking? '#0EA5E9' : talking? '#10B981' : '#F59E0B'} />
                    <text x={0} y={0.5} textAnchor="middle" fontSize={5.5} fontWeight={800} fill="white">{walking?'يمشي': talking?'يتحدث':'يفكر'}</text>
                  </g>
                )}
                {/* glow for followed */}
                {isFollow && <circle cx={0} cy={0} r={22} fill="none" stroke="#CBA36B" strokeWidth={1} opacity={0.4}><animate attributeName="r" values="20;24;20" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.4;0;0.4" dur="1.6s" repeatCount="indefinite"/></circle>}
              </g>
            );
          })}

          {/* proximity collab */}
          {(()=>{
            const ids=Object.keys(movables);
            const pairs: [string,string,number,number][]=[];
            for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++){ const ma=movables[ids[a]!]!, mb=movables[ids[b]!]!; const d=Math.hypot(ma.x-mb.x, ma.y-mb.y); if(d<86 && d>16) pairs.push([ids[a]!,ids[b]!,(ma.x+mb.x)/2,(ma.y+mb.y)/2]); }
            return pairs.slice(0,2).map(([ia,ib,cx,cy])=>(
              <g key={`${ia}-${ib}`}><line x1={movables[ia]!.x} y1={movables[ia]!.y} x2={movables[ib]!.x} y2={movables[ib]!.y} stroke={SA.brass} strokeWidth={1.2} strokeDasharray="4 4" opacity={0.35}/><g transform={`translate(${cx},${cy-16})`}><rect x={-26} y={-7} width={52} height={12} rx={6} fill="white" stroke={SA.brass} strokeWidth={0.8}/><text x={0} y={0.5} textAnchor="middle" fontSize={6} fontWeight={700} fill="#92400E">يتعاونان ✨</text></g></g>
            ));
          })()}
        </svg>
      </div>
    </div>
  );
}
