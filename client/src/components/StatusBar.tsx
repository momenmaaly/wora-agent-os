/**
 * StatusBar.tsx — Wora Agent OS
 * KameHouse-style top bar: brand + live room status + agent telemetry
 */
import { useShallow } from 'zustand/react/shallow';
import { useWoraStore, selectConnected } from '../store/useWoraStore.js';

const C = {
  bg:     'rgba(4,4,18,0.92)',
  border: 'rgba(0,229,255,0.1)',
  accent: '#00E5FF',
  green:  '#00FF88',
  violet: '#7B61FF',
  muted:  '#6366a0',
  text:   '#e0e8ff',
};

export function StatusBar() {
  const connected        = useWoraStore(selectConnected);
  const agents           = useWoraStore(useShallow((s) => Object.values(s.agents)));
  const connectionErr    = useWoraStore((s) => s.connectionError);
  const roomId           = useWoraStore((s) => s.roomId);
  const showSidebar      = useWoraStore((s) => s.ui.showSidebar);
  const showWorkspaceHUD = useWoraStore((s) => s.ui.showWorkspaceHUD);
  const toggleHUD        = useWoraStore.getState().toggleWorkspaceHUD;

  const thinking = agents.filter((a) =>
    ['THINKING', 'REFINING', 'EXECUTING_TOOL', 'EXECUTING'].includes(a.lifecycleState),
  ).length;
  const active = agents.filter((a) => a.lifecycleState !== 'IDLE').length;

  return (
    <header
      style={{
        position:       'fixed',
        top:            0,
        left:           showSidebar ? '256px' : 0,
        right:          0,
        height:         '44px',
        zIndex:         10,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 20px',
        background:     C.bg,
        borderBottom:   `1px solid ${C.border}`,
        backdropFilter: 'blur(16px)',
        transition:     'left 0.3s ease',
      }}
    >
      {/* ── Left: Brand + live connection ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {!showSidebar && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width:          '22px',
                  height:         '22px',
                  background:     `linear-gradient(135deg, ${C.violet}, ${C.accent})`,
                  borderRadius:   '5px',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  fontFamily:     'monospace',
                  fontWeight:     900,
                  fontSize:       '11px',
                  color:          '#000',
                }}
              >
                W
              </div>
              <span
                style={{
                  fontFamily:    'monospace',
                  fontWeight:    700,
                  fontSize:      '12px',
                  color:         C.text,
                  letterSpacing: '3px',
                }}
              >
                WORA OS
              </span>
            </div>
            <div style={{ width: '1px', height: '16px', background: 'rgba(0,229,255,0.12)' }} />
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width:        '6px',
              height:       '6px',
              borderRadius: '50%',
              background:   connected ? C.green : '#f87171',
              boxShadow:    connected ? `0 0 8px ${C.green}` : 'none',
            }}
          />
          <span
            style={{
              fontFamily:    'monospace',
              fontSize:      '10px',
              color:         connected ? C.green : '#f87171',
              letterSpacing: '1px',
            }}
          >
            {connected ? `LIVE · ${roomId}` : (connectionErr ?? 'CONNECTING…')}
          </span>
        </div>
      </div>

      {/* ── Right: Agent stats + Workspace toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        {thinking > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              className="animate-wora-pulse"
              style={{
                width:        '6px',
                height:       '6px',
                borderRadius: '50%',
                background:   C.violet,
                boxShadow:    `0 0 8px ${C.violet}`,
                display:      'inline-block',
              }}
            />
            <span
              style={{
                fontFamily:    'monospace',
                fontSize:      '10px',
                color:         C.violet,
                letterSpacing: '1px',
              }}
            >
              {thinking} THINKING
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontFamily:    'monospace',
              fontSize:      '10px',
              color:         active > 0 ? C.accent : C.muted,
              letterSpacing: '1px',
            }}
          >
            {active}/{agents.length}
          </span>
          <span
            style={{
              fontFamily:    'monospace',
              fontSize:      '9px',
              color:         C.muted,
              letterSpacing: '1px',
            }}
          >
            AGENTS
          </span>
        </div>

        <div style={{ width: '1px', height: '16px', background: 'rgba(0,229,255,0.12)' }} />

        <button
          onClick={toggleHUD}
          style={{
            padding:       '5px 12px',
            background:    showWorkspaceHUD ? 'rgba(0,229,255,0.1)' : 'transparent',
            border:        `1px solid ${showWorkspaceHUD ? 'rgba(0,229,255,0.45)' : 'rgba(0,229,255,0.2)'}`,
            borderRadius:  '4px',
            color:         showWorkspaceHUD ? C.accent : C.muted,
            fontFamily:    'monospace',
            fontSize:      '10px',
            letterSpacing: '1px',
            cursor:        'pointer',
          }}
        >
          ◇ WORKSPACE
        </button>
      </div>
    </header>
  );
}
