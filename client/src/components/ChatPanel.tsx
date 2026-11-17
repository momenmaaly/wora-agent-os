/**
 * ChatPanel.tsx — Wora Agent OS
 * KameHouse-style dark terminal chat with jank-free streaming scroll
 */
import { useRef, useEffect, useState } from 'react';
import {
  useWoraStore,
  selectAgentsMap,
  selectConnected,
  selectMessages,
  selectSelectedAgent,
  selectStreams,
} from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { MessageType } from '../types.js';

const C = {
  bg:      'rgba(6,7,24,0.97)',
  border:  'rgba(0,229,255,0.15)',
  accent:  '#00E5FF',
  accent2: '#7B61FF',
  green:   '#00FF88',
  text:    '#e0e8ff',
  muted:   '#6366a0',
  dim:     '#12142e',
};

export function ChatPanel() {
  const messages      = useWoraStore(selectMessages);
  const activeStreams = useWoraStore(selectStreams);
  const agentsMap     = useWoraStore(selectAgentsMap);
  const selectedAgent = useWoraStore(selectSelectedAgent);
  const localUserId   = useWoraStore((s) => s.localUserId);
  const connected     = useWoraStore(selectConnected);
  const chatExpanded  = useWoraStore((s) => s.ui.chatExpanded);
  const toggleChat    = useWoraStore.getState().toggleChat;

  const { sendMessage } = useSocket();

  const [input, setInput] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef   = useRef(true);

  const streamEntries = Object.values(activeStreams);

  // Smooth scroll on new discrete messages; instant scroll on rapid stream chunks (prevents jank)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTo({
      top:      el.scrollHeight,
      behavior: streamEntries.length > 0 ? 'auto' : 'smooth',
    });
  }, [messages.length, streamEntries]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 64;
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !connected) return;
    stickToBottomRef.current = true;
    if (sendMessage(text)) {
      setInput('');
    }
  };

  const placeholder = !connected
    ? 'Connecting…'
    : selectedAgent
      ? `Message ${selectedAgent.displayName} or @mention…`
      : '@Aria what should we build?';

  return (
    <div
      style={{
        position:       'fixed',
        bottom:         0,
        right:          0,
        zIndex:         20,
        display:        'flex',
        flexDirection:  'column',
        width:          chatExpanded ? '340px' : '180px',
        height:         chatExpanded ? '420px' : '40px',
        background:     C.bg,
        border:         `1px solid ${C.border}`,
        borderRadius:   '12px 0 0 0',
        backdropFilter: 'blur(20px)',
        boxShadow:      chatExpanded ? '0 0 40px rgba(0,229,255,0.08)' : 'none',
        transition:     'width 0.25s ease, height 0.25s ease',
        overflow:       'hidden',
      }}
    >
      {/* ── Header ── */}
      <div
        onClick={toggleChat}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '0 14px',
          height:         '40px',
          cursor:         'pointer',
          borderBottom:   chatExpanded ? `1px solid ${C.border}` : 'none',
          flexShrink:     0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontFamily:    'monospace',
              fontSize:      '11px',
              fontWeight:    700,
              color:         C.accent,
              letterSpacing: '2px',
            }}
          >
            CHAT
          </span>
          {streamEntries.length > 0 && (
            <span
              className="animate-wora-pulse"
              style={{
                width:        '6px',
                height:       '6px',
                borderRadius: '50%',
                background:   C.green,
                boxShadow:    `0 0 8px ${C.green}`,
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width:        '6px',
              height:       '6px',
              borderRadius: '50%',
              background:   connected ? C.green : '#f87171',
              boxShadow:    connected ? `0 0 6px ${C.green}` : 'none',
            }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: C.muted }}>
            {chatExpanded ? '▾' : '▴'}
          </span>
        </div>
      </div>

      {chatExpanded && (
        <>
          {/* ── Messages ── */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="wora-scroll"
            style={{
              flex:          1,
              overflowY:     'auto',
              padding:       '12px 14px',
              display:       'flex',
              flexDirection: 'column',
              gap:           '10px',
            }}
          >
            {messages.length === 0 && streamEntries.length === 0 && (
              <p
                style={{
                  fontFamily:    'monospace',
                  fontSize:      '10px',
                  color:         C.muted,
                  textAlign:     'center',
                  marginTop:     '24px',
                  fontStyle:     'italic',
                  letterSpacing: '1px',
                }}
              >
                {connected ? '> select or @mention an agent to start' : '> connecting to server…'}
              </p>
            )}

            {messages.map((msg) => {
              if (msg.type === MessageType.System) {
                return (
                  <div key={msg.id} style={{ textAlign: 'center', padding: '2px 6px' }}>
                    <span
                      style={{
                        fontFamily:    'monospace',
                        fontSize:      '9.5px',
                        color:         '#f59e0b',
                        letterSpacing: '0.5px',
                      }}
                    >
                      — {msg.content} —
                    </span>
                  </div>
                );
              }

              const senderAgent = agentsMap[msg.senderId];
              const isSelf      = msg.senderId === localUserId && !senderAgent;
              const isAgent     = !isSelf;
              const badgeColor  = senderAgent?.profile?.avatarColor ?? (isAgent ? C.accent2 : C.accent);
              const senderLabel = senderAgent?.displayName ?? (isAgent ? msg.senderId : 'YOU');

              return (
                <div
                  key={msg.id}
                  style={{
                    display:       'flex',
                    flexDirection: isAgent ? 'row' : 'row-reverse',
                    gap:           '8px',
                  }}
                >
                  <div
                    style={{
                      maxWidth:     '85%',
                      padding:      '8px 12px',
                      borderRadius: isAgent ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                      background:   isAgent ? 'rgba(99,102,241,0.12)' : 'rgba(0,229,255,0.08)',
                      border:       `1px solid ${isAgent ? 'rgba(99,102,241,0.22)' : 'rgba(0,229,255,0.16)'}`,
                    }}
                  >
                    <p
                      style={{
                        fontFamily:    'monospace',
                        fontSize:      '9px',
                        fontWeight:    700,
                        color:         badgeColor,
                        marginBottom:  '4px',
                        letterSpacing: '1px',
                      }}
                    >
                      {senderLabel}
                    </p>
                    <p
                      dir="auto"
                      style={{
                        fontFamily: 'monospace',
                        fontSize:   '11px',
                        color:      C.text,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak:  'break-word',
                        margin:     0,
                      }}
                    >
                      {msg.content}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Active token streams */}
            {streamEntries.map((stream) => {
              const streamAgent = agentsMap[stream.agentId];
              const label = streamAgent?.displayName ?? stream.agentId;
              const color = streamAgent?.profile?.avatarColor ?? C.accent2;

              return (
                <div key={stream.messageId} style={{ display: 'flex', gap: '8px' }}>
                  <div
                    style={{
                      maxWidth:     '85%',
                      padding:      '8px 12px',
                      borderRadius: '4px 12px 12px 12px',
                      background:   'rgba(99,102,241,0.08)',
                      border:       '1px solid rgba(99,102,241,0.22)',
                    }}
                  >
                    <p
                      style={{
                        fontFamily:    'monospace',
                        fontSize:      '9px',
                        fontWeight:    700,
                        color,
                        marginBottom:  '4px',
                        letterSpacing: '1px',
                      }}
                    >
                      {label}{' '}
                      <span className="animate-wora-pulse" style={{ display: 'inline-block' }}>
                        ···
                      </span>
                    </p>
                    <p
                      dir="auto"
                      style={{
                        fontFamily: 'monospace',
                        fontSize:   '11px',
                        color:      C.text,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak:  'break-word',
                        margin:     0,
                      }}
                    >
                      {stream.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Input ── */}
          <div
            style={{
              display:    'flex',
              gap:        '8px',
              padding:    '10px 14px',
              borderTop:  `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <input
              dir="auto"
              style={{
                flex:         1,
                padding:      '8px 12px',
                background:   C.dim,
                border:       '1px solid rgba(0,229,255,0.18)',
                borderRadius: '6px',
                color:        C.text,
                fontFamily:   'monospace',
                fontSize:     '11px',
                outline:      'none',
              }}
              placeholder={placeholder}
              value={input}
              maxLength={4000}
              disabled={!connected}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!connected || !input.trim()}
              style={{
                padding:      '8px 14px',
                background:   connected && input.trim() ? C.accent2 : 'transparent',
                border:       `1px solid ${connected && input.trim() ? C.accent2 : 'rgba(99,102,241,0.2)'}`,
                borderRadius: '6px',
                color:        connected && input.trim() ? '#fff' : C.muted,
                fontFamily:   'monospace',
                fontSize:     '13px',
                fontWeight:   700,
                cursor:       connected && input.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              ↑
            </button>
          </div>
        </>
      )}
    </div>
  );
}
