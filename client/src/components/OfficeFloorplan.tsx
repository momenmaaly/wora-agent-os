import { useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Eye } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { WORLD_WIDTH, WORLD_HEIGHT, OFFICE_ROOMS, CORRIDORS, ROOM_SPOTS, getAgentHomeSpot, computeOfficePath, PROVIDER_VISUALS } from '../office/layout.js';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { BrainProvider } from '../types.js';

/**
 * Wora Courtyard-Houses — Industrial Loft Edition
 * User chose: industrial_loft + courtyard_houses + entrance_identity + lived_in
 * Each pavilion is a distinct house around the oasis, steel & concrete, with its own door.
 */

// ── palette ──
const INK='#0B0F19', STEEL='#2A303E', CONCRETE='#E8E4DE', CONCRETE2='#D6D1C7', BRASS='#CBA36B', RUST='#B45309';
const OASIS_BG='#E6F0E8', OASIS_WATER='#7EC8C0';

// per-house identity — roof + entrance + wall treatment
const HOUSE: Record<string,{ wall:string; roof:string; accent:string; roofType:'gable'|'flat-parapet'|'shed'|'glass'; entrance:'arch-najdi'|'pivot-steel'|'double-glass'|'rolling'|'greenhouse'|'bunker'|'folding'|'neon'|'wood-glass'|'vault'; gardenSide:'left'|'right'|'none'; material:'brick'|'concrete'|'steel-glass' }> = {
  'zone-product':   { wall:'#FFF8EC', roof:'#CBA36B', accent:'#C87941', roofType:'gable', entrance:'arch-najdi', gardenSide:'right', material:'brick' },
  'zone-planning':  { wall:'#F4F4F5', roof:'#3F3F46', accent:'#71717A', roofType:'flat-parapet', entrance:'pivot-steel', gardenSide:'none', material:'concrete' },
  'zone-boardroom': { wall:'#FFFBF0', roof:'#0B0F19', accent:'#CBA36B', roofType:'flat-parapet', entrance:'double-glass', gardenSide:'left', material:'steel-glass' },
  'zone-engineering':{ wall:'#EFF6FF', roof:'#1E293B', accent:'#0EA5E9', roofType:'shed', entrance:'rolling', gardenSide:'right', material:'concrete' },
  'zone-design':    { wall:'#FFF0F7', roof:'#FDF2F8', accent:'#EC4899', roofType:'glass', entrance:'greenhouse', gardenSide:'none', material:'steel-glass' },
  'zone-review':    { wall:'#FFF7ED', roof:'#7C2D12', accent:'#EA580C', roofType:'flat-parapet', entrance:'bunker', gardenSide:'left', material:'brick' },
  'zone-lounge':    { wall:'#F0FDF4', roof:'#14532D', accent:'#2A9D8F', roofType:'gable', entrance:'folding', gardenSide:'right', material:'brick' },
  'zone-marketing': { wall:'#ECFEFF', roof:'#0E7490', accent:'#06B6D4', roofType:'shed', entrance:'neon', gardenSide:'none', material:'steel-glass' },
  'zone-sales':     { wall:'#F5F3FF', roof:'#7C3AED', accent:'#7C3AED', roofType:'gable', entrance:'wood-glass', gardenSide:'left', material:'brick' },
  'zone-analytics': { wall:'#ECFDF5', roof:'#064E3B', accent:'#059669', roofType:'flat-parapet', entrance:'vault', gardenSide:'right', material:'concrete' },
};

interface MovableAgent { id:string; x:number; y:number; path:{x:number;y:number}[]; isWalking:boolean; facing:number; }
const AGENT_SPEED=135, USER_SPEED=155;

export function OfficeFloorplan(){
  const agents=useWoraStore(s=>s.agents);
  const selectedId=useWoraStore(s=>s.selectedAgentId), followId=useWoraStore(s=>s.followAgentId);
  const selectAgent=useWoraStore(s=>s.selectAgent), setFollow=useWoraStore(s=>s.setFollowAgent);
  const theme=useWoraStore(s=>s.ui.theme); const isDark=theme==='dark';
  const plan=useBillingStore(s=>s.plan);

  const [scale,setScale]=useState(1.08);
  const [pan,setPan]=useState({x:0,y:-18});
  const containerRef=useRef<HTMLDivElement>(null), svgRef=useRef<SVGSVGElement>(null);
  const isPanning=useRef(false), panStart=useRef<{x:number;y:number;panX:number;panY:number}|null>(null);

  const [movables,setMovables]=useState<Record<string,MovableAgent>>(()=>{
    const m:Record<string,MovableAgent>={};
    Object.values(agents).forEach((a,i)=>{ const spot=getAgentHomeSpot(a,i); m[a.id]={id:a.id,x:spot.x,y:spot.y,path:[],isWalking:false,facing:0}; });
    return m;
  });
  const [userPos,setUserPos]=useState({x:1000,y:440});
  const [userPath,setUserPath]=useState<{x:number;y:number}[]>([]);
  const [userFacing,setUserFacing]=useState(0);

  useEffect(()=>{ setMovables(prev=>{ const n={...prev}; Object.values(agents).forEach((a,i)=>{ if(!n[a.id]){ const spot=getAgentHomeSpot(a,i); n[a.id]={id:a.id,x:spot.x,y:spot.y,path:[],isWalking:false,facing:0}; }}); return n; }); },[agents]);

  useEffect(()=>{
    let raf=0, last=performance.now();
    const tick=(now:number)=>{
      const dt=(now-last)/1000; last=now;
      setMovables(prev=>{
        const next={...prev};
        for(const id of Object.keys(next)){
          const m=next[id]!; if(m.path.length===0) continue;
          const t=m.path[0]!; const dx=t.x-m.x, dy=t.y-m.y, dist=Math.hypot(dx,dy), step=AGENT_SPEED*dt;
          if(dist<=step){ m.x=t.x; m.y=t.y; m.path=m.path.slice(1); m.facing=Math.atan2(dy,dx)*180/Math.PI; if(m.path.length===0) m.isWalking=false; }
          else { m.x+=dx/dist*step; m.y+=dy/dist*step; m.facing=Math.atan2(dy,dx)*180/Math.PI; m.isWalking=true; }
        }
        return {...next};
      });
      if(userPath.length>0){
        const t=userPath[0]!; const dx=t.x-userPos.x, dy=t.y-userPos.y, dist=Math.hypot(dx,dy), step=USER_SPEED*dt;
        if(dist<=step){ setUserPos({x:t.x,y:t.y}); setUserPath(p=>p.slice(1)); if(Math.hypot(dx,dy)>1) setUserFacing(Math.atan2(dy,dx)*180/Math.PI); }
        else { setUserPos(p=>({x:p.x+dx/dist*step, y:p.y+dy/dist*step})); setUserFacing(Math.atan2(dy,dx)*180/Math.PI); }
      }
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick); return ()=>cancelAnimationFrame(raf);
  },[userPath,userPos]);

  useEffect(()=>{
    const t=setInterval(()=>{
      const ids=Object.keys(agents); if(!ids.length) return;
      const id=ids[Math.floor(Math.random()*ids.length)]!;
      const rooms=OFFICE_ROOMS; const r=rooms[Math.floor(Math.random()*rooms.length)]!;
      const spots=ROOM_SPOTS.filter(s=>s.roomId===r.id); const spot=spots[Math.floor(Math.random()*spots.length)] ?? spots[0]; if(!spot) return;
      const m=movables[id]; if(!m||m.isWalking) return;
      const path=computeOfficePath({x:m.x,y:m.y}, spot.id);
      if(path.length) setMovables(prev=>({...prev,[id]:{...prev[id]!,path,isWalking:true}}));
    },3800);
    return ()=>clearInterval(t);
  },[agents,movables]);

  const viewBox=useMemo(()=>{
    const vbW=WORLD_WIDTH/scale, vbH=WORLD_HEIGHT/scale;
    const cx=WORLD_WIDTH/2 - pan.x, cy=WORLD_HEIGHT/2 - pan.y;
    return `${cx - vbW/2} ${cy - vbH/2} ${vbW} ${vbH}`;
  },[scale,pan]);

  const zoomIn=()=>setScale(s=>Math.min(1.8,s*1.2)), zoomOut=()=>setScale(s=>Math.max(0.6,s/1.2)), resetView=()=>{setScale(1.08); setPan({x:0,y:-18});};
  const onPointerDown=(e:React.PointerEvent)=>{ if(e.shiftKey||e.button===1){ isPanning.current=true; panStart.current={x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y}; }};
  const onPointerMove=(e:React.PointerEvent)=>{ if(!isPanning.current||!panStart.current) return; const dx=(e.clientX-panStart.current.x)/scale, dy=(e.clientY-panStart.current.y)/scale; setPan({x:panStart.current.panX+dx,y:panStart.current.panY+dy}); };
  const onPointerUp=()=>{ isPanning.current=false; panStart.current=null; };
  const handleFloorClick=(e:React.MouseEvent<SVGSVGElement>)=>{
    if(!svgRef.current) return;
    const pt=svgRef.current.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
    const ctm=svgRef.current.getScreenCTM()?.inverse(); if(!ctm) return;
    const p=pt.matrixTransform(ctm);
    const path=computeOfficePath(userPos,{x:p.x,y:p.y});
    if(path.length) setUserPath(path);
  };
  useEffect(()=>{ if(!followId) return; const m=movables[followId]; if(!m) return; setPan({x:m.x-WORLD_WIDTH/2,y:m.y-WORLD_HEIGHT/2}); },[followId,movables]);

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col overflow-hidden bg-[#EDE9E0] dark:bg-[#0B0F19]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-stone-300 bg-white/95 px-1 py-1 shadow-sm backdrop-blur">
          <button onClick={zoomOut} className="h-7 w-7 rounded-full hover:bg-stone-100 flex items-center justify-center"><ZoomOut className="h-4 w-4"/></button>
          <span className="min-w-[3rem] text-center font-mono text-xs font-bold">{Math.round(scale*100)}%</span>
          <button onClick={zoomIn} className="h-7 w-7 rounded-full hover:bg-stone-100 flex items-center justify-center"><ZoomIn className="h-4 w-4"/></button>
          <span className="mx-1 h-4 w-px bg-stone-200"/><button onClick={resetView} className="h-7 w-7 rounded-full hover:bg-stone-100 flex items-center justify-center"><Maximize2 className="h-4 w-4"/></button>
        </div>
        <div className="pointer-events-auto hidden sm:flex items-center gap-1.5">
          <span className="rounded-full border border-stone-300 bg-white/95 px-2.5 py-1 text-[11px] font-bold flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/> مجمّع صناعي حول الواحة — كل بيت له باب وشرفة</span>
          {followId && <button onClick={()=>setFollow(null)} className="rounded-full bg-[#0B0F19] px-3 py-1 text-xs font-bold text-white flex items-center gap-1"><Eye className="h-3.5 w-3.5"/> إلغاء المتابعة</button>}
        </div>
      </div>

      <div className="flex-1 overflow-hidden" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{cursor: isPanning.current?'grabbing':'default'}}>
        <svg ref={svgRef} viewBox={viewBox} className="h-full w-full select-none" onClick={handleFloorClick} style={{background: isDark?'#0B0F19':CONCRETE}}>
          <defs>
            <pattern id="concretePaver" width="40" height="40" patternUnits="userSpaceOnUse"><rect width={40} height={40} fill={CONCRETE}/><rect x={0} y={0} width={40} height={1} fill={CONCRETE2}/><rect x={0} y={0} width={1} height={40} fill={CONCRETE2}/></pattern>
            <filter id="houseShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="8" stdDeviation="10" floodOpacity={isDark?0.4:0.14}/></filter>
            <pattern id="brick" width="22" height="8" patternUnits="userSpaceOnUse"><rect width={22} height={8} fill="#C9A48A"/><rect x={0} y={0} width={22} height={1.2} fill="#8B6B55"/><rect x={11} y={4} width={1} height={4} fill="#8B6B55"/></pattern>
          </defs>

          <rect x={0} y={0} width={WORLD_WIDTH} height={WORLD_HEIGHT} rx={18} fill="url(#concretePaver)"/>

          {/* oasis courtyard — center of the compound */}
          <g filter="url(#houseShadow)">
            <rect x={760} y={382} width={480} height={316} rx={16} fill={isDark?'#1A241E':OASIS_BG} stroke={isDark?'#2D4A32':'#8FBC8F'} strokeWidth={1.5}/>
            {/* water */}
            <ellipse cx={1000} cy={530} rx={86} ry={48} fill={OASIS_WATER} opacity={0.35}/>
            <ellipse cx={1000} cy={534} rx={70} ry={34} fill={OASIS_WATER} opacity={0.55}/>
            <path d="M 945 534 Q 1000 526 1055 534" stroke="white" strokeWidth={1.1} opacity={0.6} fill="none" strokeLinecap="round"><animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.4s" repeatCount="indefinite"/></path>
            {/* palms + pergola */}
            {[{x:800,y:420},{x:1160,y:420},{x:800,y:640},{x:1160,y:640},{x:1000,y:400}].map((p,i)=>(
              <g key={i} transform={`translate(${p.x},${p.y})`}><rect x={-2} y={-12} width={4} height={18} rx={2} fill="#6B4423"/><g fill="#3A7D44"><ellipse cx={-9} cy={-13} rx={9} ry={3.5} transform="rotate(-20)"/><ellipse cx={9} cy={-13} rx={9} ry={3.5} transform="rotate(20)"/><ellipse cx={0} cy={-16} rx={6} ry={9}/></g></g>
            ))}
            {/* steel pergola top */}
            <g stroke={STEEL} strokeWidth={1.5} opacity={0.5}><line x1={780} y1={395} x2={1220} y2={395}/><line x1={780} y1={405} x2={1220} y2={405}/>{[820,900,980,1060,1140].map(x=> <line key={x} x1={x} y1={395} x2={x} y2={685} strokeWidth={1} opacity={0.35}/>)}</g>
            <text x={1000} y={402} textAnchor="middle" fontSize={7} fontWeight={800} fill={isDark?'#8FBC8F':'#2F5D34'} letterSpacing={1.2}>ساحة الواحة — قلب المجمّع</text>
          </g>

          {/* pathways — steel-framed concrete */}
          {Object.values(CORRIDORS).map(c=>{
            const isH=c.width>c.height;
            return (
              <g key={c.id}>
                <rect x={c.x} y={c.y} width={c.width} height={c.height} rx={8} fill={isDark?'#1C2130':CONCRETE} stroke={STEEL} strokeWidth={1.2} />
                <rect x={c.x+4} y={c.y+4} width={c.width-8} height={c.height-8} rx={6} fill="none" stroke={BRASS} strokeWidth={0.6} opacity={0.25} strokeDasharray="8 6"/>
                {/* steel columns */}
                {Array.from({length: isH? Math.floor(c.width/70):Math.floor(c.height/70)}).map((_,i)=>{
                  const px=isH? c.x+30+i*70 : c.x+c.width/2, py=isH? c.y+c.height/2 : c.y+30+i*70;
                  return <g key={i}><rect x={px-2.5} y={py-8} width={5} height={16} rx={1} fill={STEEL}/><circle cx={px} cy={py-10} r={2} fill={BRASS} opacity={0.7}/></g>;
                })}
              </g>
            );
          })}

          {/* HOUSES — each is a distinct building */}
          {OFFICE_ROOMS.map(room=>{
            const h=HOUSE[room.id] ?? HOUSE['zone-planning']!;
            const isSel=selectedId? agents[selectedId]?.zoneId===room.id : false;
            const locked=isRoomLockedForPlan(room.id, plan);
            const roofH = h.roofType==='gable'? 18 : h.roofType==='shed'? 12 : 8;
            return (
              <g key={room.id} filter="url(#houseShadow)" opacity={locked?0.88:1}>
                <rect x={room.x+4} y={room.y+6} width={room.width} height={room.height} rx={10} fill="black" opacity={isDark?0.35:0.1}/>
                {/* garden strip — lived-in greenery */}
                {h.gardenSide!=='none' && (
                  <g>
                    <rect x={h.gardenSide==='left'? room.x-8 : room.x+room.width-6} y={room.y+24} width={14} height={room.height-36} rx={6} fill="#8FBC8F" opacity={0.45}/>
                    {[0,1,2].map(k=> <circle key={k} cx={(h.gardenSide==='left'? room.x-1: room.x+room.width+1)} cy={room.y+50+k*22} r={3.5} fill="#2D5A3D" opacity={0.7}/>)}
                  </g>
                )}
                {/* main house body */}
                <rect x={room.x} y={room.y} width={room.width} height={room.height} rx={10} fill={isDark?'#1A1F2E':h.wall} stroke={isSel? h.accent : locked? BRASS : STEEL} strokeWidth={isSel?2.2: locked?1.8:1.2} strokeDasharray={locked?'7 4':undefined}/>
                {/* material hint */}
                {h.material==='brick' && <rect x={room.x} y={room.y+roofH} width={room.width} height={room.height-roofH} rx={0} fill="url(#brick)" opacity={isDark?0.15:0.08}/>}
                {h.material==='concrete' && <g opacity={0.07}>{[0,1,2].map(k=> <line key={k} x1={room.x} y1={room.y+roofH+20+k*18} x2={room.x+room.width} y2={room.y+roofH+20+k*18} stroke={STEEL} strokeWidth={0.6}/>)}</g>}
                {/* roof */}
                {h.roofType==='gable' && <path d={`M ${room.x} ${room.y+roofH} L ${room.x+room.width/2} ${room.y-6} L ${room.x+room.width} ${room.y+roofH} Z`} fill={h.roof} stroke={STEEL} strokeWidth={1}/>}
                {h.roofType==='shed' && <path d={`M ${room.x} ${room.y+roofH} L ${room.x+room.width} ${room.y} L ${room.x+room.width} ${room.y+roofH} Z`} fill={h.roof} stroke={STEEL} strokeWidth={1}/>}
                {h.roofType==='flat-parapet' && <><rect x={room.x} y={room.y} width={room.width} height={roofH} rx={4} fill={h.roof} stroke={STEEL} strokeWidth={1}/><rect x={room.x+8} y={room.y+2} width={room.width-16} height={3} rx={1.5} fill={BRASS} opacity={0.5}/></>}
                {h.roofType==='glass' && <><rect x={room.x} y={room.y} width={room.width} height={roofH} rx={6} fill="#E0F2FE" stroke={h.accent} strokeWidth={1.2} opacity={0.9}/><line x1={room.x+room.width/3} y1={room.y} x2={room.x+room.width/3} y2={room.y+roofH} stroke={h.accent} strokeWidth={0.8} opacity={0.3}/><line x1={room.x+2*room.width/3} y1={room.y} x2={room.x+2*room.width/3} y2={room.y+roofH} stroke={h.accent} strokeWidth={0.8} opacity={0.3}/></>}
                {/* chimney/vent for industrial */}
                {(h.roofType==='shed'||h.roofType==='flat-parapet') && <rect x={room.x+room.width-18} y={room.y-4} width={6} height={10} rx={1} fill={STEEL}/>}

                {/* header */}
                <rect x={room.x+10} y={room.y+roofH+6} width={room.width-20} height={16} rx={8} fill={isDark?'rgba(0,0,0,0.3)':'white'} stroke={isDark?'rgba(255,255,255,0.08)':'#E8E4DE'}/>
                <text x={room.x+14} y={room.y+roofH+16} fontSize={6.5} fontWeight={800} fill={h.accent}>{room.code}</text>
                <text x={room.x+36} y={room.y+roofH+16} fontSize={8.5} fontWeight={800} fill={isDark?'white':INK}>{room.nameAr}</text>
                {locked && <g transform={`translate(${room.x+room.width-12},${room.y+roofH+8})`}><circle r={6} fill={BRASS} stroke="white" strokeWidth={1}/><text textAnchor="middle" dy={2} fontSize={5} fontWeight={900} fill="white">♛</text></g>}

                {/* ENTRANCE — each is different */}
                {room.doors.map(d=>{
                  const isH=d.wall==='north'||d.wall==='south';
                  const cx=isH? (d.from+d.to)/2 : (d.wall==='west'? room.x : room.x+room.width);
                  const cy=!isH? (d.from+d.to)/2 : (d.wall==='north'? room.y : room.y+room.height);
                  const w=isH? d.to-d.from:10, hh=!isH? d.to-d.from:10;
                  // pick door style for this room's entrance type
                  return (
                    <g key={d.id}>
                      {h.entrance==='arch-najdi' && <><rect x={isH?d.from:cx-6} y={!isH?d.from:cy-6} width={w} height={hh} rx={isH?6:3} fill="#8B5A2B" stroke={STEEL} strokeWidth={1}/><path d={isH? `M ${d.from+6} ${cy} A 10 10 0 0 1 ${d.to-6} ${cy}`:`M ${cx} ${d.from+6} A 10 10 0 0 1 ${cx} ${d.to-6}`} stroke="#D6BFA0" fill="none" strokeWidth={1}/><text x={cx} y={cy+2} textAnchor="middle" fontSize={4} fill="white" opacity={0.9}>⌬</text></>}
                      {h.entrance==='pivot-steel' && <><rect x={isH?d.from:cx-5} y={!isH?d.from:cy-5} width={w} height={hh} rx={1} fill={STEEL} stroke="#111" strokeWidth={1.2}/><line x1={isH?(d.from+d.to)/2:cx} y1={!isH?d.from:cy-4} x2={isH?(d.from+d.to)/2:cx} y2={!isH?d.to:cy+4} stroke={BRASS} strokeWidth={2}/></>}
                      {h.entrance==='double-glass' && <><rect x={isH?d.from:cx-7} y={!isH?d.from:cy-7} width={w} height={hh} rx={2} fill="rgba(255,255,255,0.85)" stroke={STEEL} strokeWidth={1.2}/><line x1={isH?(d.from+d.to)/2:cx} y1={!isH?d.from:cy-6} x2={isH?(d.from+d.to)/2:cx} y2={!isH?d.to:cy+6} stroke={STEEL} strokeWidth={1} opacity={0.6}/><line x1={isH?d.from+4:cx-5} y1={!isH?d.from+6:cy} x2={isH?d.to-4:cx+5} y2={!isH?d.from+6:cy} stroke={BRASS} strokeWidth={0.6} opacity={0.4}/></>}
                      {h.entrance==='rolling' && <><rect x={isH?d.from:cx-7} y={!isH?d.from:cy-7} width={w} height={hh} rx={1} fill="#3F3F46" stroke={STEEL} strokeWidth={1}/>{[0,1,2,3].map(k=> <line key={k} x1={isH?d.from+4:cx-5} y1={!isH?d.from+6+k*5:cy-4} x2={isH?d.to-4:cx+5} y2={!isH?d.from+6+k*5:cy-4} stroke="#71717A" strokeWidth={0.7} opacity={0.5}/>)}</>}
                      {h.entrance==='greenhouse' && <><rect x={isH?d.from:cx-8} y={!isH?d.from:cy-8} width={w} height={hh} rx={2} fill="rgba(224,242,254,0.6)" stroke={h.accent} strokeWidth={1.2}/><line x1={isH?d.from+10:cx} y1={!isH?d.from:cy+8} x2={isH?d.to-10:cx} y2={!isH?d.to:cy-8} stroke={h.accent} strokeWidth={0.6} opacity={0.4}/></>}
                      {h.entrance==='bunker' && <><rect x={isH?d.from:cx-6} y={!isH?d.from:cy-6} width={w} height={hh} rx={2} fill={STEEL} stroke="#111" strokeWidth={1.5}/><circle cx={cx} cy={cy} r={2} fill={BRASS}/><circle cx={cx+4} cy={cy} r={1} fill="#111"/></>}
                      {h.entrance==='folding' && <><rect x={isH?d.from:cx-8} y={!isH?d.from:cy-8} width={w} height={hh} rx={3} fill="#F5F5F4" stroke={STEEL} strokeWidth={1}/>{[0,1,2].map(k=> <line key={k} x1={isH?d.from+8+k*12:cx} y1={!isH?d.from:cy-6} x2={isH?d.from+8+k*12:cx} y2={!isH?d.to:cy+6} stroke={STEEL} strokeWidth={0.7} opacity={0.4}/>)}</>}
                      {h.entrance==='neon' && <><rect x={isH?d.from:cx-7} y={!isH?d.from:cy-7} width={w} height={hh} rx={4} fill="rgba(255,255,255,0.9)" stroke={h.accent} strokeWidth={1.5}/><rect x={isH?d.from:cx-7} y={!isH?d.from:cy-7} width={w} height={hh} rx={4} fill="none" stroke={h.accent} strokeWidth={0.8} opacity={0.5}><animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.8s" repeatCount="indefinite"/></rect></>}
                      {h.entrance==='wood-glass' && <><rect x={isH?d.from:cx-7} y={!isH?d.from:cy-7} width={w} height={hh} rx={2} fill="#D6BFA0" stroke={STEEL} strokeWidth={1}/><rect x={isH?d.from+4:cx-4} y={!isH?d.from+4:cy-4} width={isH?w-8:8} height={!isH?hh-8:8} rx={1} fill="rgba(255,255,255,0.7)" stroke={STEEL} strokeWidth={0.6}/></>}
                      {h.entrance==='vault' && <><rect x={isH?d.from:cx-7} y={!isH?d.from:cy-7} width={w} height={hh} rx={7} fill={STEEL} stroke={BRASS} strokeWidth={1.2}/><circle cx={cx} cy={cy} r={3} fill={INK} stroke={BRASS} strokeWidth={0.8}/><text x={cx} y={cy+0.8} textAnchor="middle" fontSize={3} fill={BRASS}>◐</text></>}
                    </g>
                  );
                })}

                {/* balcony for Pro houses */}
                {locked===false && (room.id==='zone-boardroom'||room.id==='zone-design') && (
                  <g><rect x={room.x+room.width-36} y={room.y+room.height-12} width={40} height={10} rx={3} fill={BRASS} opacity={0.85} stroke={STEEL} strokeWidth={0.8}/><line x1={room.x+room.width-32} y1={room.y+room.height-12} x2={room.x+room.width-32} y2={room.y+room.height-4} stroke={STEEL} strokeWidth={0.7}/><line x1={room.x+room.width-14} y1={room.y+room.height-12} x2={room.x+room.width-14} y2={room.y+room.height-4} stroke={STEEL} strokeWidth={0.7}/></g>
                )}

                {/* interior — lived-in clutter */}
                {ROOM_SPOTS.filter(s=>s.roomId===room.id).map(spot=>{
                  const isDesk=spot.role==='desk'||spot.role==='desk-alt', isMeet=spot.role==='meeting', isCollab=spot.role==='collab', isCoffee=spot.role==='coffee';
                  const occupant=Object.values(agents).find(a=> a.zoneId===room.id && !useWoraStore.getState().agentLocations[a.id]?.isWalking);
                  const occupied=!!occupant, deskOccupied=isDesk && occupied;
                  // lived-in: papers scattered, plant, mug
                  return (
                    <g key={spot.id} onClick={e=>{ e.stopPropagation(); if(occupant) selectAgent(occupant.id); }} style={{cursor: occupant?'pointer':'default'}}>
                      {isDesk && (
                        <>
                          <rect x={spot.x-26} y={spot.y-14} width={52} height={28} rx={6} fill={isDark?'#232837':'white'} stroke={STEEL} strokeWidth={0.8}/>
                          <rect x={spot.x-26} y={spot.y-14} width={52} height={3} rx={2} fill={h.accent} opacity={0.7}/>
                          {/* papers lived-in */}
                          <rect x={spot.x-20} y={spot.y-8} width={12} height={8} rx={1} fill="#FEF9C3" stroke="#EAB308" strokeWidth={0.5} opacity={0.9} transform={`rotate(-6 ${spot.x-14} ${spot.y-4})`}/>
                          <rect x={spot.x-6} y={spot.y-9} width={10} height={7} rx={1} fill="#DBEAFE" opacity={0.8} transform={`rotate(4 ${spot.x-1} ${spot.y-5})`}/>
                          <rect x={spot.x-8} y={spot.y-5} width={18} height={10} rx={2} fill={isDark?'#0F141F':'#F8FAFC'} stroke={deskOccupied? h.accent:STEEL} strokeWidth={deskOccupied?1.2:0.6}/>
                          {deskOccupied && <rect x={spot.x-6} y={spot.y-3} width={14} height={5} rx={1} fill={h.accent} opacity={0.15}/>}
                          <g transform={`translate(${spot.x},${spot.y+16})`}><ellipse cx={0} cy={2.5} rx={10} ry={3} fill="black" opacity={isDark?0.32:0.07}/><rect x={-9} y={-5} width={18} height={8} rx={4} fill={occupied? occupant!.profile.avatarColor : '#EDE6D6'} stroke={deskOccupied?'white':'none'} strokeWidth={deskOccupied?1:0}/><rect x={-6} y={-9} width={12} height={5} rx={2.5} fill={occupied? occupant!.profile.avatarColor:'#EDE6D6'} opacity={0.95}/></g>
                          {/* plant on desk */}
                          <g transform={`translate(${spot.x+16},${spot.y-10})`}><rect x={-2} y={-2} width={4} height={5} rx={1} fill="#D6BFA0"/><circle cx={0} cy={-4} r={3} fill="#22C55E" opacity={0.9}/></g>
                          <circle cx={spot.x+12} cy={spot.y-1} r={2.6} fill="white" stroke={h.accent} strokeWidth={0.6}/>
                        </>
                      )}
                      {isMeet && <><rect x={spot.x-16} y={spot.y-10} width={32} height={20} rx={7} fill={isDark?'#232837':'white'} stroke={STEEL}/><circle cx={spot.x} cy={spot.y} r={3.5} fill={h.accent} opacity={0.1}/>{[0,1,2,3,4,5].map(k=>{ const ang=(k*60-30)*Math.PI/180, r=14; return <circle key={k} cx={spot.x+Math.cos(ang)*r} cy={spot.y+Math.sin(ang)*r*0.6} r={2.8} fill="#EDE6D6" stroke={h.accent} strokeWidth={0.5}/>; })}</>}
                      {isCollab && <><rect x={spot.x-20} y={spot.y-12} width={40} height={24} rx={7} fill={isDark?'#232837':'white'} stroke={STEEL}/><rect x={spot.x-12} y={spot.y-2} width={24} height={5} rx={2} fill={h.accent} opacity={0.08}/><circle cx={spot.x-8} cy={spot.y-14} r={1.5} fill={RUST} opacity={0.5}/></>}
                      {isCoffee && <><rect x={spot.x-18} y={spot.y-12} width={36} height={24} rx={7} fill="white" stroke={STEEL}/><rect x={spot.x-7} y={spot.y-6} width={14} height={12} rx={2} fill="#6F4E37"/><text x={spot.x} y={spot.y+4} textAnchor="middle" fontSize={4} fill="white">COFFEE</text></>}
                      {(spot.role==='lounge') && <><rect x={spot.x-18} y={spot.y-8} width={36} height={16} rx={8} fill={h.accent} opacity={0.1} stroke={h.accent}/><circle cx={spot.x} cy={spot.y} r={4} fill={h.accent} opacity={0.15}/></>}
                      {(spot.role as string)==='showcase' && <><rect x={spot.x-16} y={spot.y-8} width={32} height={16} rx={4} fill="white" stroke={h.accent}/><text x={spot.x} y={spot.y+2} textAnchor="middle" fontSize={5} fontWeight={800} fill={h.accent}>SHOW</text></>}
                      {(spot.role as string)==='stage' && <><rect x={spot.x-22} y={spot.y-6} width={44} height={12} rx={6} fill={h.accent} opacity={0.12} stroke={h.accent}/><text x={spot.x} y={spot.y+2} textAnchor="middle" fontSize={5} fontWeight={800} fill={h.accent}>STAGE</text></>}
                    </g>
                  );
                })}
                {locked && <g><rect x={room.x+10} y={room.y+roofH+22} width={room.width-20} height={room.height-roofH-32} rx={8} fill="white" opacity={0.7}/><text x={room.x+room.width/2} y={room.y+room.height/2+4} textAnchor="middle" fontSize={7} fontWeight={800} fill="#78350F">🔒  ترقية لفتح هذا البيت</text></g>}
              </g>
            );
          })}

          {/* trails */}
          {Object.values(movables).map(m=>{
            if(!m.path.length) return null;
            const all=[{x:m.x,y:m.y},...m.path], d=all.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ');
            const ac=agents[m.id]?.profile.avatarColor ?? BRASS;
            return <g key={`trail-${m.id}`}><path d={d} fill="none" stroke={ac} strokeWidth={2.6} strokeDasharray="6 6" opacity={0.32} className="animate-route-dash"/><path d={d} fill="none" stroke="white" strokeWidth={0.9} strokeDasharray="6 6" opacity={0.5} className="animate-route-dash"/></g>;
          })}

          {/* user */}
          <g transform={`translate(${userPos.x},${userPos.y})`}><ellipse cx={0} cy={11} rx={12} ry={4} fill="black" opacity={isDark?0.28:0.08}/><g transform={`rotate(${userFacing} 0 0)`}><rect x={-10} y={-8} width={20} height={16} rx={6} fill="#0EA5E9" stroke="white" strokeWidth={1.3}/><circle cx={0} cy={-10} r={8} fill="#0EA5E9" stroke="white" strokeWidth={1.3}/><text x={0} y={-6.5} textAnchor="middle" fontSize={7} fontWeight={800} fill="white">YOU</text><polygon points="8,-1 12,0 8,1.5" fill="#0EA5E9" stroke="white" strokeWidth={0.7}/></g><rect x={-20} y={-26} width={40} height={11} rx={5} fill={isDark?'#0F141F':'white'} stroke="#0EA5E9" strokeWidth={1}/><text x={0} y={-18.5} textAnchor="middle" fontSize={6.5} fontWeight={800} fill={isDark?'white':'#0B0F19'}>أنت</text></g>

          {/* agents — industrial workwear */}
          {Object.values(agents).map(ag=>{
            const m=movables[ag.id]; if(!m) return null;
            const isSel=selectedId===ag.id, isFollow=followId===ag.id, walking=m.isWalking, thinking=ag.lifecycleState==='THINKING', talking=ag.lifecycleState==='RESPONDING';
            return (
              <g key={ag.id} transform={`translate(${m.x},${m.y})`} onClick={e=>{ e.stopPropagation(); selectAgent(ag.id); }} style={{cursor:'pointer'}}>
                <ellipse cx={0} cy={13} rx={13} ry={4} fill="black" opacity={isDark?0.32:0.1}/>
                {isSel && <circle cx={0} cy={0} r={18} fill="none" stroke={ag.profile.avatarColor} strokeWidth={1.3} opacity={0.5} strokeDasharray="4 3"/>}
                <g transform={`rotate(${walking? m.facing*0.1:0} 0 0)`}>
                  {/* work jacket */}
                  <path d="M -9 2 L -7 -8 L 7 -8 L 9 2 L 4 7 L -4 7 Z" fill={ag.profile.avatarColor} stroke="white" strokeWidth={1.2}/>
                  <rect x={-1.2} y={-6} width={2.4} height={10} rx={1} fill="white" opacity={0.9}/>
                  <circle cx={0} cy={-10} r={7.2} fill={ag.profile.avatarColor} stroke="white" strokeWidth={1.2}/>
                  <text x={0} y={-7} textAnchor="middle" fontSize={5.5} fontWeight={900} fill="white">{ag.displayName.slice(0,2).toUpperCase()}</text>
                </g>
                <g><rect x={-28} y={-28} width={56} height={13} rx={6} fill={isDark?'#0F141F':'white'} stroke={isSel? ag.profile.avatarColor:'#E8E4DE'} strokeWidth={isSel?1.2:0.8}/><text x={0} y={-19.5} textAnchor="middle" fontSize={7} fontWeight={800} fill={isDark?'white':INK}>{ag.displayName}</text></g>
                {(thinking||talking||walking) && <g transform="translate(14,-34)"><rect x={-10} y={-6} width={20} height={10} rx={5} fill={walking?'#0EA5E9': talking?'#10B981':'#F59E0B'}/><text x={0} y={0.5} textAnchor="middle" fontSize={5} fontWeight={800} fill="white">{walking?'يمشي': talking?'يتحدث':'يفكر'}</text></g>}
                {isFollow && <circle cx={0} cy={0} r={22} fill="none" stroke={BRASS} strokeWidth={1} opacity={0.35}><animate attributeName="r" values="20;24;20" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.35;0;0.35" dur="1.6s" repeatCount="indefinite"/></circle>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
