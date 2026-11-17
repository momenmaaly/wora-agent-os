/**
 * SharedWorkspaceHUD.tsx — Wora Agent OS
 * KameHouse-style workspace panel: tasks, artifacts, reviews & signals
 */
import { useState } from 'react';
import {
  useWoraStore,
  selectUI,
  selectWorkspaces,
  selectZones,
} from '../store/useWoraStore.js';
import type { SharedWorkspaceEntry } from '../types.js';

const C = {
  bg:      'rgba(6,7,24,0.97)',
  border:  'rgba(0,229,255,0.12)',
  accent:  '#00E5FF',
  green:   '#00FF88',
  gold:    '#FFB800',
  text:    '#e0e8ff',
  muted:   '#6366a0',
  surface: 'rgba(13,13,34,0.8)',
};

const STATUS_COLOR: Record<string, string> = {
  open:           '#FFB800',
  claimed:        '#818cf8',
  in_progress:    '#00E5FF',
  review_pending: '#f97316',
  approved:       '#00FF88',
  rejected:       '#f87171',
  done:           '#6366a0',
  expired:        '#3f3f6a',
};

const TYPE_ICON: Record<string, string> = {
  task:     '▸',
  artifact: '◈',
  review:   '◎',
  signal:   '◉',
  handoff:  '⇄',
};

function EntryCard({ entry }: { entry: SharedWorkspaceEntry }) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[entry.status] ?? C.muted;

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        background:   C.surface,
        border:       `1px solid ${expanded ? `${color}38` : 'rgba(0,229,255,0.08)'}`,
        borderRadius: '8px',
        padding:      '10px 12px',
        cursor:       'pointer',
        transition:   'border-color 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span
          style={{
            color,
            fontSize:   '14px',
            fontFamily: 'monospace',
            flexShrink: 0,
            marginTop:  '1px',
          }}
        >
          {TYPE_ICON[entry.type] ?? '◆'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily:   'monospace',
              fontSize:     '11px',
              fontWeight:   700,
              color:        C.text,
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              marginBottom: '3px',
            }}
          >
            {entry.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                fontFamily:    'monospace',
                fontSize:      '9px',
                fontWeight:    700,
                color,
                letterSpacing: '1px',
              }}
            >
              {entry.status.replace('_', ' ').toUpperCase()}
            </span>
            <span style={{ color: C.muted, fontSize: '9px' }}>·</span>
            <span
              style={{
                fontFamily:   'monospace',
                fontSize:     '9px',
                color:        C.muted,
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
              }}
            >
              {entry.authorAgentId}
            </span>
          </div>
        </div>
      </div>

      {expanded && entry.payload && Object.keys(entry.payload).length > 0 && (
        <pre
          className="wora-scroll"
          style={{
            marginTop:    '10px',
            fontFamily:   'monospace',
            fontSize:     '9px',
            color:        C.muted,
            background:   'rgba(0,0,0,0.4)',
            border:       '1px solid rgba(0,229,255,0.08)',
            borderRadius: '4px',
            padding:      '8px',
            overflow:     'auto',
            maxHeight:    '110px',
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-word',
          }}
        >
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function SharedWorkspaceHUD() {
  const workspaces = useWoraStore(selectWorkspaces);
  const zones      = useWoraStore(selectZones);
  const ui         = useWoraStore(selectUI);
  const toggleHUD  = useWoraStore.getState().toggleWorkspaceHUD;
  const [activeZone, setActiveZone] = useState<string | null>(null);

  if (!ui.showWorkspaceHUD) {
    return null;
  }

  const wsArr     = Object.values(workspaces);
  const curZoneId = activeZone ?? zones[0]?.id;
  const ws        = curZoneId ? workspaces[curZoneId] : wsArr[0];
  const entries   = ws?.entries ?? [];
  const open      = entries.filter((e) => !['done', 'expired', 'rejected', 'approved'].includes(e.status));
  const done      = entries.filter((e) => e.status === 'done' || e.status === 'approved');

  // Avoid colliding with the expanded ChatPanel in the bottom-right corner
  const bottomClearance = ui.chatExpanded ? 436 : 64;

  return (
    <div
      style={{
        position:       'fixed',
        top:            '56px',
        right:          '16px',
        width:          '308px',
        maxHeight:      `max(220px, calc(100vh - ${56 + bottomClearance}px))`,
        display:        'flex',
        flexDirection:  'column',
        zIndex:         25,
        background:     C.bg,
        border:         `1px solid ${C.border}`,
        borderRadius:   '12px',
        backdropFilter: 'blur(20px)',
        boxShadow:      '0 0 60px rgba(0,229,255,0.06)',
        overflow:       'hidden',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '12px 16px',
          borderBottom:   `1px solid ${C.border}`,
          flexShrink:     0,
        }}
      >
        <span
          style={{
            fontFamily:    'monospace',
            fontSize:      '11px',
            fontWeight:    700,
            color:         C.accent,
            letterSpacing: '2px',
          }}
        >
          ◇ WORKSPACE
        </span>
        <button
          onClick={toggleHUD}
          style={{
            background: 'none',
            border:     'none',
            color:      C.muted,
            cursor:     'pointer',
            fontSize:   '14px',
            lineHeight: 1,
          }}
          title="Close workspace panel"
        >
          ✕
        </button>
      </div>

      {/* ── Zone tabs ── */}
      {zones.length > 1 && (
        <div
          className="wora-scroll"
          style={{
            display:      'flex',
            overflowX:    'auto',
            gap:          '4px',
            padding:      '8px 12px',
            borderBottom: `1px solid ${C.border}`,
            flexShrink:   0,
          }}
        >
          {zones.map((z) => {
            const isActive = curZoneId === z.id;
            return (
              <button
                key={z.id}
                onClick={() => setActiveZone(z.id)}
                style={{
                  flexShrink:    0,
                  padding:       '4px 10px',
                  borderRadius:  '4px',
                  border:        'none',
                  background:    isActive ? `${z.themeColor}18` : 'transparent',
                  color:         isActive ? z.themeColor : C.muted,
                  fontFamily:    'monospace',
                  fontSize:      '9px',
                  fontWeight:    700,
                  letterSpacing: '1px',
                  cursor:        'pointer',
                  borderBottom:  `2px solid ${isActive ? z.themeColor : 'transparent'}`,
                }}
              >
                {z.name.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Stats ── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap:                 '8px',
          padding:             '10px 14px',
          borderBottom:        `1px solid ${C.border}`,
          flexShrink:          0,
        }}
      >
        {[
          { label: 'TOTAL', value: entries.length, color: C.text },
          { label: 'OPEN',  value: open.length,    color: C.gold },
          { label: 'DONE',  value: done.length,    color: C.green },
        ].map((stat) => (
          <div key={stat.label} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '20px', fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
            <div
              style={{
                fontFamily:    'monospace',
                fontSize:      '8px',
                color:         C.muted,
                letterSpacing: '2px',
                marginTop:     '2px',
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Entries list ── */}
      <div
        className="wora-scroll"
        style={{
          flex:          1,
          overflowY:     'auto',
          padding:       '10px 12px',
          display:       'flex',
          flexDirection: 'column',
          gap:           '6px',
        }}
      >
        {entries.length === 0 && (
          <p
            style={{
              fontFamily: 'monospace',
              fontSize:   '10px',
              color:      C.muted,
              textAlign:  'center',
              marginTop:  '20px',
              fontStyle:  'italic',
            }}
          >
            No workspace entries in this zone yet.
          </p>
        )}
        {[...entries].reverse().map((entry) => (
          <EntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
