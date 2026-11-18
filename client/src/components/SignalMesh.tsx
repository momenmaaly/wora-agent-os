import { useId, type CSSProperties } from 'react';
import { visibleNodes } from '../office/channels.js';
import type { AgentParticipant } from '../types.js';
import { AgentAvatar, agentSignal, AgentSignal } from './AgentAvatar.js';

const slots = [
  { x: 78, y: 25, path: 'M624 100H548L484 164H429', tap: 'M716 58h-94l-26 26v16M506 142v-27l23-23h27' },
  { x: 22, y: 25, path: 'M176 100h76l64 64h55', tap: 'M84 58h94l26 26v16m90 42v-27l-23-23h-27' },
  { x: 78, y: 75, path: 'M624 300H548l-64-64h-55', tap: 'M716 342h-94l-26-26v-16m-90-42v27l23 23h27' },
  { x: 22, y: 75, path: 'M176 300h76l64-64h55', tap: 'M84 342h94l26-26v-16m90-42v27l-23 23h-27' },
] as const;
const grain = Array.from({ length: 46 }, (_, i) => ({ x: (i * 193 + 63) % 776 + 12, y: (i * 107 + 39) % 380 + 10, prime: i % 7 === 0 }));

function Kernel() {
  const id = useId();
  return <svg className="mesh-kernel" viewBox="0 0 360 340" aria-hidden="true" fill="none">
    <defs>
      <radialGradient id={`${id}-field`}><stop stopColor="currentColor" stopOpacity=".25" /><stop offset=".55" stopColor="currentColor" stopOpacity=".05" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#64ffe0" /><stop offset="1" stopColor="#cef973" /></linearGradient>
      <pattern id={`${id}-tiles`} width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 9V0h9" stroke="currentColor" strokeOpacity=".1" strokeWidth=".6" /></pattern>
    </defs>
    <circle cx="180" cy="170" r="167" fill={`url(#${id}-field)`} />
    <g className="kernel-outer" stroke="currentColor">
      <circle cx="180" cy="170" r="150" strokeOpacity=".38" strokeDasharray="1 5" />
      <circle cx="180" cy="170" r="139" strokeOpacity=".32" />
      <circle cx="180" cy="170" r="130" strokeOpacity=".82" strokeDasharray=".9 11.1" strokeWidth="4" />
      <circle cx="180" cy="170" r="110" strokeOpacity=".47" strokeDasharray="16 6 2 5 3 7" />
      <path opacity=".56" d="M180 12v24m0 268v24M22 170h24m268 0h24M70 60l16 16m188 188 16 16M70 280l16-16M274 76l16-16" />
      <path opacity=".58" strokeWidth="2" d="M167 21h26m-26 298h26M31 157v26m298-26v26M67 112a129 129 0 0 1 42-46m184 162a129 129 0 0 1-42 46" />
      <path className="kernel-scanner" d="M180 29a141 141 0 0 1 100 42" strokeWidth="2" strokeDasharray="20 4 7 2 80" />
    </g>
    <path d="M180 74 261 121v98l-81 47-81-47v-98z" fill="var(--mesh-base)" stroke="currentColor" strokeOpacity=".56" />
    <path d="M180 84 252 127v86l-72 43-72-43v-86z" fill={`url(#${id}-tiles)`} stroke="currentColor" strokeOpacity=".38" />
    <path d="M180 74 261 121l-81 46-81-46m81 46v99m81-47-81-47-81 47m81-145v94" stroke="currentColor" strokeDasharray="3 4" strokeOpacity=".35" />
    <g className="kernel-logo" stroke={`url(#${id}-beam)`} strokeLinejoin="round" strokeLinecap="round">
      <path d="M139 144h16l12 31 13-32 13 32 12-31h16l-24 54h-9l-8-21-8 21h-9z" strokeWidth="2.5" />
      <path d="m139 144 28 31 5 23m8-55v34m41-33-28 31-5 23m-32-63 24-14 24 14m-34 73 10 7 10-7" strokeWidth="1" opacity=".65" />
    </g>
  </svg>;
}

export function SignalMesh({ agents, selected, onSelect }: { agents: readonly AgentParticipant[]; selected?: string; onSelect: (id: string) => void }) {
  const nodes = visibleNodes(agents, selected ?? null);
  return <div className="signal-mesh" dir="ltr" data-node-count={nodes.length}>
    <svg className="mesh-traces" viewBox="0 0 800 400" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <path className="mesh-crosshair" d="M400 7v386M12 200h776M24 50V24h26m700 0h26v26M24 350v26h26m700 0h26v-26M96 200h78m452 0h78" />
      {grain.map(({ x, y, prime }, i) => <rect className={prime ? 'mesh-pixel prime' : 'mesh-pixel'} key={i} x={x} y={y} width={prime ? 3 : 1.7} height={prime ? 3 : 1.7} />)}
      {slots.map(({ x, y, path, tap }, i) => {
        const agent = nodes[i];
        return <g className="mesh-lane" key={i} data-linked={Boolean(agent)} data-selected={Boolean(agent && agent.id === selected)} data-signal={agent ? agentSignal(agent) : 'offline'}>
          <path className="mesh-tap" d={tap} />
          <path className="mesh-trace" d={path} />
          <path className="mesh-packet" d={path} />
          <circle cx={x * 8} cy={y * 4} r="4" />
        </g>;
      })}
    </svg>
    <div className="mesh-kernel-stack" aria-hidden="true"><Kernel /><span dir="ltr">WORA / CORE</span></div>
    <div className="mesh-caption mesh-caption-top" aria-hidden="true"><span>NEURAL BUS <b>·</b> R01</span><span>SIGNAL MESH</span></div>
    <div className="mesh-caption mesh-caption-bottom" aria-hidden="true"><span>SYS // WORA</span><span>{String(nodes.length).padStart(2, '0')} NODES</span></div>
    {nodes.map((agent, i) => {
      const slot = slots[i]!;
      return <button type="button" className="mesh-node" key={agent.id} data-agent-id={agent.id} style={{ '--node-x': `${slot.x}%`, '--node-y': `${slot.y}%` } as CSSProperties}
        onClick={() => onSelect(agent.id)} aria-pressed={agent.id === selected} aria-label={`اختيار ${agent.displayName}`} aria-describedby={`signal-${agent.id}`} dir="ltr">
        <AgentAvatar agent={agent} /><span className="mesh-node-copy"><bdi title={agent.displayName}>{agent.displayName}</bdi><span id={`signal-${agent.id}`}><AgentSignal agent={agent} code /></span></span>
      </button>;
    })}
  </div>;
}
