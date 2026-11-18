import type { CSSProperties } from 'react';
import { AgentLifecycleState, ParticipantStatus, lifecycleToAvatarState, type AgentParticipant } from '../types.js';

const glyphs = {
  'agent-planner-01': 'M3 17 12 5l9 12M6 13h12M12 5v15',
  'agent-coder-01': 'M8 6 3 12l5 6m8-12 5 6-5 6M14 4l-4 16',
  'agent-reviewer-01': 'M12 3 20 7v6l-8 7-8-7V7zM8 11l3 3 5-5',
  'agent-analyst-01': 'M4 17v-5m5 5V6m6 11V9m5 8V4M3 20h18',
} as const;
const alternateGlyph = 'M12 3 21 8v8l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v8';

export function agentSignal(agent: AgentParticipant) {
  if (agent.status !== ParticipantStatus.Online && agent.status !== ParticipantStatus.Busy) return 'offline';
  return lifecycleToAvatarState(agent.lifecycleState);
}

const labels = {
  offline: ['غير متاح', 'OFFLINE'],
  idle: ['جاهز', 'IDLE'],
  thinking: ['يفكّر', 'THINKING'],
  talking: ['يردّ', 'RESPONDING'],
  error: ['خطأ في الرد', 'ERROR'],
} as const;

export function AgentSignal({ agent, code = false }: { agent: AgentParticipant; code?: boolean }) {
  const signal = agentSignal(agent);
  const label = signal === 'offline' ? labels.offline : agent.lifecycleState === AgentLifecycleState.Executing || agent.lifecycleState === AgentLifecycleState.ExecutingTool ? ['يعالج المهمة', 'EXECUTING']
    : agent.lifecycleState === AgentLifecycleState.Refining ? ['يعيد المحاولة', 'RETRYING'] : labels[signal];
  return <span className="agent-signal" data-signal={signal} title={code ? label[0] : undefined}><i aria-hidden="true" />{code ? <bdi dir="ltr">{label[1]}</bdi> : label[0]}</span>;
}

export function AgentAvatar({ agent, className = '' }: { agent: AgentParticipant; className?: string }) {
  const signal = agentSignal(agent);
  const color = /^#[\da-f]{6}$/iu.test(agent.profile.avatarColor) ? agent.profile.avatarColor : undefined;
  const glyph = glyphs[agent.id as keyof typeof glyphs] ?? alternateGlyph;
  return <span className={`agent-avatar ${className}`} data-avatar-state={signal} style={{ '--agent-color': color } as CSSProperties} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none">
      <path className="avatar-outline" d="M13 3h22l10 10v22L35 45H13L3 35V13Z" />
      <path className="avatar-contacts" d="M8 20v-5l7-7h5m8 32h5l7-7v-5M22 5h4m-4 38h4M5 22v4m38-4v4" />
      <path className="avatar-loop" d="M24 8a16 16 0 1 1 0 32 16 16 0 1 1 0-32Z" />
      {signal === 'error'
        ? <path className="avatar-fault" d="m11 16 6 1 3 4m-7 10 7-2 3-4 4 5 7 1m-7-10 7-6m-9 9h.1M24 35h.1" />
        : signal === 'talking' ? <path className="avatar-core avatar-wave" d="M10 24h7l3-6 4 12 4-15 4 9h6" />
          : <path className="avatar-core" d={glyph} transform="translate(12 12)" />}
    </svg>
  </span>;
}
