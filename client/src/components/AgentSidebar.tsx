/**
 * AgentSidebar.tsx — Wora Agent OS
 * KameHouse-style dark sidebar with agent list + per-room Hot-Swap Brain
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWoraStore, selectSelectedAgent, selectUI } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { BrainProvider, BRAIN_MODELS, BRAIN_PROVIDER_LABELS, DEFAULT_BRAIN_MODEL } from '../types.js';
import type { PublicBrainConfig } from '../types.js';

/* ─── lifecycle color map ─── */
const LC: Record<string, string> = {
  IDLE:           '#44446a',
  THINKING:       '#818cf8',
  REFINING:       '#a78bfa',
  EXECUTING_TOOL: '#fbbf24',
  EXECUTING:      '#fbbf24',
  RESPONDING:     '#00FF88',
  ERROR:          '#f87171',
  BOOTING:        '#64748b',
};

function StatusDot({ state }: { state: string }) {
  const color = LC[state] ?? '#44446a';
  const pulse = ['THINKING', 'REFINING', 'EXECUTING_TOOL', 'EXECUTING', 'BOOTING'].includes(state);
  return (
    <span
      className={pulse ? 'animate-wora-pulse' : undefined}
      style={{
        display:         'inline-block',
        width:           '8px',
        height:          '8px',
        borderRadius:    '50%',
        backgroundColor: color,
        boxShadow:       pulse ? `0 0 8px ${color}` : 'none',
        flexShrink:      0,
      }}
    />
  );
}

/* ─── Brain Swap Modal ─── */
interface BrainSwapModalProps {
  agentId:      string;
  currentBrain: PublicBrainConfig | null;
  onClose:      () => void;
}

function BrainSwapModal({ agentId, currentBrain, onClose }: BrainSwapModalProps) {
  const { swapBrain } = useSocket();
  const [provider, setProvider] = useState<BrainProvider>(
    currentBrain?.provider ?? BrainProvider.Google,
  );
  const [model, setModel] = useState<string>(
    currentBrain?.model ?? BRAIN_MODELS[BrainProvider.Google][0] ?? DEFAULT_BRAIN_MODEL,
  );
  const [saving, setSaving] = useState(false);

  const models = BRAIN_MODELS[provider] ?? [];

  const handleProviderChange = (p: BrainProvider) => {
    setProvider(p);
    setModel(BRAIN_MODELS[p][0] ?? '');
  };

  const handleSwap = () => {
    if (!model || saving) return;
    setSaving(true);
    const sent = swapBrain(agentId, { provider, model });
    if (!sent) {
      setSaving(false);
      return;
    }
    window.setTimeout(onClose, 200);
  };

  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         200,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:   '#0c0c20',
          border:       '1px solid rgba(99,102,241,0.35)',
          borderRadius: '14px',
          padding:      '28px',
          width:        '320px',
          boxShadow:    '0 0 60px rgba(99,102,241,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            color:         '#e0e8ff',
            fontFamily:    'monospace',
            fontSize:      '14px',
            fontWeight:    700,
            letterSpacing: '2px',
            marginBottom:  '20px',
          }}
        >
          ⚡ HOT-SWAP BRAIN
        </h3>

        {/* Provider */}
        <label
          style={{
            color:         '#6366a0',
            fontFamily:    'monospace',
            fontSize:      '10px',
            letterSpacing: '2px',
            display:       'block',
            marginBottom:  '6px',
          }}
        >
          PROVIDER
        </label>
        <select
          style={{
            width:        '100%',
            padding:      '8px 10px',
            background:   '#0a0a1e',
            border:       '1px solid rgba(99,102,241,0.25)',
            borderRadius: '6px',
            color:        '#e0e8ff',
            fontFamily:   'monospace',
            fontSize:     '12px',
            marginBottom: '14px',
            outline:      'none',
          }}
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as BrainProvider)}
        >
          {Object.values(BrainProvider).map((p) => (
            <option key={p} value={p}>
              {BRAIN_PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>

        {/* Model */}
        <label
          style={{
            color:         '#6366a0',
            fontFamily:    'monospace',
            fontSize:      '10px',
            letterSpacing: '2px',
            display:       'block',
            marginBottom:  '6px',
          }}
        >
          MODEL
        </label>
        <select
          style={{
            width:        '100%',
            padding:      '8px 10px',
            background:   '#0a0a1e',
            border:       '1px solid rgba(99,102,241,0.25)',
            borderRadius: '6px',
            color:        '#e0e8ff',
            fontFamily:   'monospace',
            fontSize:     '12px',
            marginBottom: '22px',
            outline:      'none',
          }}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            style={{
              flex:          1,
              padding:       '10px',
              background:    saving ? '#2d2d6a' : '#4f46e5',
              border:        'none',
              borderRadius:  '6px',
              color:         '#fff',
              fontFamily:    'monospace',
              fontSize:      '12px',
              fontWeight:    700,
              cursor:        'pointer',
              letterSpacing: '1px',
              transition:    'background 0.2s',
            }}
            onClick={handleSwap}
            disabled={saving}
          >
            {saving ? 'SWAPPING…' : 'SWAP →'}
          </button>
          <button
            style={{
              padding:      '10px 18px',
              background:   'transparent',
              border:       '1px solid rgba(99,102,241,0.3)',
              borderRadius: '6px',
              color:        '#6366a0',
              fontFamily:   'monospace',
              fontSize:     '12px',
              cursor:       'pointer',
            }}
            onClick={onClose}
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Sidebar ─── */
export function AgentSidebar() {
  const agents        = useWoraStore(useShallow((s) => Object.values(s.agents)));
  const selectedAgent = useWoraStore(selectSelectedAgent);
  const ui            = useWoraStore(selectUI);
  const [brainModal, setBrainModal] = useState(false);

  const selectAgent   = useWoraStore.getState().selectAgent;
  const toggleSidebar = useWoraStore.getState().toggleSidebar;

  if (!ui.showSidebar) {
    return (
      <button
        onClick={toggleSidebar}
        style={{
          position:       'fixed',
          left:           '8px',
          top:            '50%',
          transform:      'translateY(-50%)',
          zIndex:         30,
          width:          '28px',
          height:         '28px',
          background:     'rgba(79,70,229,0.6)',
          border:         '1px solid rgba(99,102,241,0.4)',
          borderRadius:   '50%',
          color:          '#c7d2fe',
          cursor:         'pointer',
          fontSize:       '16px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
        }}
        title="Show sidebar"
      >
        ›
      </button>
    );
  }

  return (
    <>
      <aside
        style={{
          position:       'fixed',
          left:           0,
          top:            0,
          height:         '100%',
          width:          '256px',
          background:     'rgba(6,7,24,0.96)',
          borderRight:    '1px solid rgba(99,102,241,0.15)',
          display:        'flex',
          flexDirection:  'column',
          zIndex:         20,
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '9px 16px',
            height:         '44px',
            borderBottom:   '1px solid rgba(99,102,241,0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width:          '26px',
                height:         '26px',
                background:     'linear-gradient(135deg, #7B61FF, #00E5FF)',
                borderRadius:   '6px',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                fontFamily:     'monospace',
                fontWeight:     900,
                fontSize:       '13px',
                color:          '#000',
              }}
            >
              W
            </div>
            <span
              style={{
                fontFamily:    'monospace',
                fontWeight:    700,
                fontSize:      '13px',
                color:         '#c7d2fe',
                letterSpacing: '3px',
              }}
            >
              WORA OS
            </span>
          </div>
          <button
            onClick={toggleSidebar}
            style={{
              background: 'none',
              border:     'none',
              color:      '#6366a0',
              cursor:     'pointer',
              fontSize:   '16px',
              lineHeight: 1,
            }}
            title="Collapse sidebar"
          >
            ‹
          </button>
        </div>

        {/* ── Agents List ── */}
        <div className="wora-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
          <div
            style={{
              fontFamily:    'monospace',
              fontSize:      '9px',
              color:         '#44446a',
              letterSpacing: '3px',
              padding:       '0 6px 10px',
            }}
          >
            AGENTS ({agents.length})
          </div>

          {agents.length === 0 && (
            <p
              style={{
                fontFamily: 'monospace',
                fontSize:   '10px',
                color:      '#44446a',
                padding:    '0 6px',
                fontStyle:  'italic',
                lineHeight: 1.6,
              }}
            >
              No agents loaded yet.
              <br />
              Run <code style={{ color: '#818cf8' }}>npm run seed</code> on API server.
            </p>
          )}

          {agents.map((agent) => {
            const isSelected = selectedAgent?.id === agent.id;
            const color = agent.profile?.avatarColor ?? '#6366f1';
            return (
              <button
                key={agent.id}
                className="wora-agent-btn"
                onClick={() => selectAgent(agent.id === selectedAgent?.id ? null : agent.id)}
                style={{
                  width:        '100%',
                  textAlign:    'left',
                  padding:      '10px',
                  borderRadius: '8px',
                  marginBottom: '2px',
                  cursor:       'pointer',
                  background:   isSelected ? `${color}15` : 'transparent',
                  border:       isSelected ? `1px solid ${color}35` : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                  <div
                    style={{
                      width:           '10px',
                      height:          '10px',
                      borderRadius:    '50%',
                      backgroundColor: color,
                      flexShrink:      0,
                      boxShadow:       isSelected ? `0 0 8px ${color}` : 'none',
                    }}
                  />
                  <span
                    style={{
                      fontFamily:    'monospace',
                      fontSize:      '12px',
                      fontWeight:    700,
                      color:         isSelected ? color : '#c7d2fe',
                      letterSpacing: '1px',
                      flex:          1,
                      overflow:      'hidden',
                      textOverflow:  'ellipsis',
                      whiteSpace:    'nowrap',
                    }}
                  >
                    {agent.displayName}
                  </span>
                  <StatusDot state={agent.lifecycleState ?? 'IDLE'} />
                </div>
                <div style={{ paddingLeft: '18px' }}>
                  <p
                    style={{
                      fontFamily:   'monospace',
                      fontSize:     '9px',
                      color:        '#6366a0',
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:   'nowrap',
                      marginBottom: '1px',
                    }}
                  >
                    {agent.profile?.customRole}
                  </p>
                  <p
                    style={{
                      fontFamily:   'monospace',
                      fontSize:     '9px',
                      color:        '#44446a',
                      overflow:     'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace:   'nowrap',
                    }}
                  >
                    {agent.brainConfig?.provider} / {agent.brainConfig?.model?.slice(0, 20)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Selected Agent Panel ── */}
        {selectedAgent &&
          (() => {
            const color = selectedAgent.profile?.avatarColor ?? '#6366f1';
            return (
              <div
                style={{
                  borderTop:  '1px solid rgba(99,102,241,0.15)',
                  padding:    '16px',
                  background: `${color}06`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div
                    style={{
                      width:           '9px',
                      height:          '9px',
                      borderRadius:    '50%',
                      backgroundColor: color,
                      boxShadow:       `0 0 8px ${color}`,
                    }}
                  />
                  <span
                    style={{
                      fontFamily:    'monospace',
                      fontSize:      '12px',
                      fontWeight:    700,
                      color,
                      letterSpacing: '1px',
                    }}
                  >
                    {selectedAgent.displayName}
                  </span>
                </div>

                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#818cf8', marginBottom: '2px' }}>
                  {selectedAgent.profile?.customRole}
                </p>
                {selectedAgent.profile?.tagline && (
                  <p
                    style={{
                      fontFamily:   'monospace',
                      fontSize:     '9px',
                      color:        '#6366a0',
                      fontStyle:    'italic',
                      marginBottom: '8px',
                    }}
                  >
                    &ldquo;{selectedAgent.profile.tagline}&rdquo;
                  </p>
                )}

                <p style={{ fontFamily: 'monospace', fontSize: '9px', color: '#6366a0', marginBottom: '8px' }}>
                  {selectedAgent.brainConfig?.provider} / {selectedAgent.brainConfig?.model}
                </p>

                {Boolean(selectedAgent.profile?.skills?.length) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                    {selectedAgent.profile.skills.slice(0, 4).map((s) => (
                      <span
                        key={s}
                        style={{
                          padding:       '2px 8px',
                          background:    `${color}18`,
                          border:        `1px solid ${color}28`,
                          borderRadius:  '20px',
                          fontFamily:    'monospace',
                          fontSize:      '9px',
                          color,
                          letterSpacing: '0.5px',
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => setBrainModal(true)}
                  style={{
                    width:         '100%',
                    padding:       '9px',
                    background:    `${color}18`,
                    border:        `1px solid ${color}30`,
                    borderRadius:  '6px',
                    color,
                    fontFamily:    'monospace',
                    fontSize:      '11px',
                    fontWeight:    700,
                    letterSpacing: '1px',
                    cursor:        'pointer',
                    transition:    'background 0.2s',
                  }}
                >
                  ⚡ HOT-SWAP BRAIN
                </button>
              </div>
            );
          })()}
      </aside>

      {brainModal && selectedAgent && (
        <BrainSwapModal
          agentId={selectedAgent.id}
          currentBrain={selectedAgent.brainConfig ?? null}
          onClose={() => setBrainModal(false)}
        />
      )}
    </>
  );
}
