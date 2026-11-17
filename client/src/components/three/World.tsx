/**
 * World.tsx — Wora Agent OS
 * KameHouse-style 3D virtual office (Zero-leak WebGL + Offline-safe lighting)
 */

import { Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Stars,
  Float,
  Html,
  Text,
  Line,
  RoundedBox,
  Sphere,
  Cylinder,
  Torus,
  Grid,
} from '@react-three/drei';
import * as THREE from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useWoraStore, selectZones } from '../../store/useWoraStore.js';
import type { AgentParticipant, WorkspaceZone } from '../../types.js';
import { AgentLifecycleState } from '../../types.js';

/* ─── STATIC SHARED COLORS (zero per-render allocations) ── */
const COLOR_SCREEN_OFF = new THREE.Color('#0a0a1a');
const COLOR_BLACK      = new THREE.Color('#000000');

function safeColor(hex: string, fallback = '#6366f1'): THREE.Color {
  try {
    return new THREE.Color(hex);
  } catch {
    return new THREE.Color(fallback);
  }
}

function agentPosition(index: number, total: number, radius = 5.5): [number, number, number] {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
}

function deskRotation(index: number, total: number): [number, number, number] {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
  return [0, -angle + Math.PI, 0];
}

/* ─── CAMERA RIG (smooth KameHouse lerp) ─────────────── */
interface CameraRigProps {
  targetPosition: THREE.Vector3 | null;
  targetLookAt:   THREE.Vector3;
}

function CameraRig({ targetPosition, targetLookAt }: CameraRigProps) {
  const { camera } = useThree();
  const currentLookAt = useRef(new THREE.Vector3(0, 1, 0));

  useFrame(() => {
    if (targetPosition) {
      camera.position.lerp(targetPosition, 0.045);
    }
    currentLookAt.current.lerp(targetLookAt, 0.045);
    camera.lookAt(currentLookAt.current);
  });

  return null;
}

/* ─── FLOOR ──────────────────────────────────────────── */
function OfficeFloor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#060818" roughness={0.9} metalness={0.1} />
      </mesh>

      <Grid
        args={[40, 40]}
        cellSize={1}
        cellThickness={0.25}
        cellColor="#1a1f4a"
        sectionSize={5}
        sectionThickness={0.5}
        sectionColor="#2d3280"
        fadeDistance={28}
        fadeStrength={1.5}
        followCamera={false}
        position={[0, 0, 0]}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[2.5, 64]} />
        <meshBasicMaterial color="#7B61FF" transparent opacity={0.06} />
      </mesh>

      <Text
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={1.4}
        color="#7B61FF"
        anchorX="center"
        anchorY="middle"
        fillOpacity={0.07}
      >
        WORA
      </Text>
    </group>
  );
}

/* ─── MONITOR SCREEN ─────────────────────────────────── */
function MonitorScreen({ color, agent }: { color: THREE.Color; agent: AgentParticipant }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null!);
  const isActive = agent.lifecycleState !== AgentLifecycleState.Idle;

  useFrame(({ clock }) => {
    if (matRef.current && isActive) {
      matRef.current.emissiveIntensity = 0.55 + Math.sin(clock.elapsedTime * 2.5) * 0.05;
    }
  });

  return (
    <meshStandardMaterial
      ref={matRef}
      color={isActive ? color : COLOR_SCREEN_OFF}
      emissive={isActive ? color : COLOR_BLACK}
      emissiveIntensity={isActive ? 0.55 : 0}
      roughness={0.05}
      metalness={0.9}
    />
  );
}

/* ─── WORKSTATION ────────────────────────────────────── */
interface WorkstationProps {
  agent:    AgentParticipant;
  index:    number;
  total:    number;
  selected: boolean;
  onClick:  () => void;
}

const DESK_LEG_OFFSETS: readonly [number, number, number][] = [
  [-0.82, 0.375, -0.38],
  [0.82,  0.375, -0.38],
  [-0.82, 0.375, 0.38],
  [0.82,  0.375, 0.38],
];

function Workstation({ agent, index, total, selected, onClick }: WorkstationProps) {
  const groupRef  = useRef<THREE.Group>(null!);
  const glowRef   = useRef<THREE.PointLight>(null!);
  const baseColor = useMemo(
    () => safeColor(agent.profile?.avatarColor ?? '#6366f1'),
    [agent.profile?.avatarColor],
  );

  const pos = useMemo(() => agentPosition(index, total), [index, total]);
  const rot = useMemo(() => deskRotation(index, total), [index, total]);

  const isWorking =
    agent.lifecycleState !== AgentLifecycleState.Idle &&
    agent.lifecycleState !== AgentLifecycleState.Error;
  const isError = agent.lifecycleState === AgentLifecycleState.Error;
  const filledBars = agent.lifecycleState === AgentLifecycleState.Responding ? 8 : 6;

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y = isWorking
        ? Math.sin(clock.elapsedTime * 0.9 + index) * 0.012
        : 0;
    }
    if (glowRef.current) {
      glowRef.current.intensity = selected
        ? 2.2 + Math.sin(clock.elapsedTime * 2) * 0.4
        : isWorking
          ? 0.95 + Math.sin(clock.elapsedTime * 1.4 + index) * 0.15
          : 0.35;
    }
  });

  return (
    <group
      ref={groupRef}
      position={pos}
      rotation={rot}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
      }}
    >
      {/* Desk surface */}
      <RoundedBox args={[2.0, 0.07, 1.0]} position={[0, 0.75, 0]} radius={0.02} castShadow>
        <meshStandardMaterial color="#10102a" roughness={0.3} metalness={0.7} />
      </RoundedBox>

      {/* Desk legs */}
      {DESK_LEG_OFFSETS.map((legPos, i) => (
        <Cylinder key={i} args={[0.025, 0.025, 0.75, 8]} position={legPos} castShadow>
          <meshStandardMaterial color="#18183a" metalness={0.9} roughness={0.2} />
        </Cylinder>
      ))}

      {/* Monitor stand */}
      <Cylinder args={[0.035, 0.05, 0.28, 8]} position={[0, 0.93, -0.16]} castShadow>
        <meshStandardMaterial color="#18183a" metalness={0.9} roughness={0.2} />
      </Cylinder>
      <RoundedBox args={[0.28, 0.03, 0.22]} position={[0, 0.8, -0.16]} radius={0.01}>
        <meshStandardMaterial color="#18183a" metalness={0.9} roughness={0.2} />
      </RoundedBox>

      {/* Monitor frame + screen */}
      <group position={[0, 1.28, -0.18]}>
        <RoundedBox args={[1.32, 0.78, 0.055]} radius={0.018} castShadow>
          <meshStandardMaterial color="#0c0c22" metalness={0.8} roughness={0.25} />
        </RoundedBox>
        <RoundedBox args={[1.2, 0.66, 0.02]} position={[0, 0, 0.038]} radius={0.008}>
          <MonitorScreen color={baseColor} agent={agent} />
        </RoundedBox>

        {isWorking && (
          <Html
            position={[0, 0, 0.055]}
            center
            distanceFactor={2.8}
            style={{ pointerEvents: 'none', width: '200px' }}
          >
            <div
              style={{
                fontFamily: 'monospace',
                fontSize:   '5.5px',
                color:      agent.profile?.avatarColor ?? '#7B61FF',
                padding:    '8px',
                lineHeight: 1.7,
                opacity:    0.92,
              }}
            >
              <div style={{ color: '#00E5FF', marginBottom: '2px' }}>// {agent.displayName}</div>
              <div style={{ opacity: 0.7 }}>role: &quot;{agent.profile?.customRole}&quot;</div>
              <div style={{ opacity: 0.7 }}>
                brain: {agent.brainConfig?.provider}/{agent.brainConfig?.model?.slice(0, 16)}
              </div>
              <div style={{ color: '#fff', marginTop: '4px' }}>
                ▶ {agent.lifecycleState?.toLowerCase()}
              </div>
              {agent.profile?.skills?.slice(0, 2).map((s) => (
                <div key={s} style={{ opacity: 0.5 }}>
                  {'  '}— {s}
                </div>
              ))}
              <div style={{ color: '#00FF88', marginTop: '3px', opacity: 0.85 }}>
                [{'█'.repeat(filledBars)}
                {'░'.repeat(10 - filledBars)}] active
              </div>
            </div>
          </Html>
        )}
      </group>

      {/* Keyboard & Mouse */}
      <RoundedBox args={[0.85, 0.018, 0.3]} position={[0, 0.8, 0.12]} radius={0.008}>
        <meshStandardMaterial color="#090920" metalness={0.7} roughness={0.5} />
      </RoundedBox>
      <RoundedBox args={[0.1, 0.018, 0.15]} position={[0.55, 0.8, 0.1]} radius={0.04}>
        <meshStandardMaterial color="#0e0e28" metalness={0.7} roughness={0.5} />
      </RoundedBox>

      {/* Status orb */}
      <Float speed={2.5} floatIntensity={0.4} rotationIntensity={0}>
        <Sphere args={[0.07, 16, 16]} position={[0.85, 1.62, -0.18]}>
          <meshStandardMaterial
            color={isError ? '#f87171' : isWorking ? '#00FF88' : '#444466'}
            emissive={isError ? '#f87171' : isWorking ? '#00FF88' : '#000000'}
            emissiveIntensity={isWorking || isError ? 2 : 0}
          />
        </Sphere>
      </Float>

      {/* Selection ring */}
      {selected && (
        <Torus args={[1.1, 0.022, 8, 72]} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={baseColor} emissive={baseColor} emissiveIntensity={2.5} />
        </Torus>
      )}

      {/* Agent floating label */}
      <Html
        position={[0, 2.1, -0.2]}
        center
        distanceFactor={9}
        style={{ pointerEvents: 'none', textAlign: 'center' }}
      >
        <div
          style={{
            fontFamily:    'monospace',
            fontSize:      '13px',
            fontWeight:    700,
            color:         agent.profile?.avatarColor ?? '#7B61FF',
            textShadow:    `0 0 18px ${agent.profile?.avatarColor ?? '#7B61FF'}`,
            letterSpacing: '2px',
            whiteSpace:    'nowrap',
          }}
        >
          {agent.displayName.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily:    'monospace',
            fontSize:      '9px',
            color:         isError ? '#f87171' : isWorking ? '#00FF88' : '#6366a0',
            marginTop:     '2px',
            letterSpacing: '1px',
          }}
        >
          {isWorking || isError ? `● ${agent.lifecycleState}` : '○ IDLE'}
        </div>
      </Html>

      <pointLight
        ref={glowRef}
        position={[0, 2.2, 0]}
        color={baseColor}
        intensity={0.9}
        distance={4.5}
        decay={2}
      />
    </group>
  );
}

/* ─── ZONE DISC ──────────────────────────────────────── */
function ZoneDisc({ zone }: { zone: WorkspaceZone }) {
  const ringRef = useRef<THREE.Mesh>(null!);
  const color   = useMemo(() => safeColor(zone.themeColor ?? '#6366f1'), [zone.themeColor]);

  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.1;
    }
  });

  const r = zone.radius ?? 3;
  return (
    <group position={[zone.position.x, 0, zone.position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r, 64]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.06}
          roughness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r - 0.06, r + 0.06, 80]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.1}
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Text
        position={[0, 0.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.3}
        color={zone.themeColor ?? '#818cf8'}
        anchorX="center"
        anchorY="middle"
        fillOpacity={0.22}
      >
        {zone.name}
      </Text>
      <pointLight position={[0, 2, 0]} intensity={0.4} color={color} distance={r * 2.2} decay={2} />
    </group>
  );
}

/* ─── AMBIENT PARTICLES ──────────────────────────────── */
function Particles() {
  const count = 120;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3]     = (Math.random() - 0.5) * 24;
      arr[i * 3 + 1] = Math.random() * 5 + 0.3;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    return arr;
  }, []);

  const ref = useRef<THREE.Points>(null!);
  useFrame(({ clock }) => {
    const attr = ref.current?.geometry.attributes['position'];
    if (!attr) return;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const yIdx = i * 3 + 1;
      arr[yIdx] = (arr[yIdx] ?? 1) + Math.sin(clock.elapsedTime * 0.4 + i * 0.3) * 0.001;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#7B61FF" size={0.025} transparent opacity={0.45} sizeAttenuation />
    </points>
  );
}

/* ─── CONNECTION LINES (Drei Line — typed & auto-disposed) ── */
function ConnectionLines({
  agents,
  selectedId,
}: {
  agents:     AgentParticipant[];
  selectedId: string | null;
}) {
  const total = agents.length;
  if (total < 2) return null;

  return (
    <group>
      {agents.map((agent, i) => {
        const pos = agentPosition(i, total);
        const isActive =
          agent.id === selectedId || agent.lifecycleState !== AgentLifecycleState.Idle;
        return (
          <Line
            key={agent.id}
            points={[
              [0, 1.5, 0],
              [pos[0], 1.5, pos[2]],
            ]}
            color={isActive ? (agent.profile?.avatarColor ?? '#7B61FF') : '#7B61FF'}
            transparent
            opacity={isActive ? 0.45 : 0.08}
            lineWidth={1}
          />
        );
      })}
    </group>
  );
}

/* ─── FALLBACK (no WebGL) ────────────────────────────── */
function FallbackWorld() {
  const agents          = useWoraStore(useShallow((s) => Object.values(s.agents)));
  const selectAgent     = useWoraStore.getState().selectAgent;
  const selectedAgentId = useWoraStore((s) => s.selectedAgentId);

  return (
    <div className="w-full h-full flex flex-col bg-background overflow-auto p-6">
      <p className="text-indigo-400 font-mono text-xs text-center mb-6 tracking-widest">
        ⬡ WORA OS — 2D WORKSPACE VIEW
      </p>
      {agents.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500 font-mono text-xs italic">
            No agents loaded yet. Run npm run seed on the API server.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto w-full">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => selectAgent(a.id === selectedAgentId ? null : a.id)}
              className={`text-left rounded-xl p-4 border transition-all ${
                a.id === selectedAgentId
                  ? 'border-indigo-500 bg-indigo-950/60'
                  : 'border-indigo-900/40 bg-card/70 hover:border-indigo-700/60'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: a.profile?.avatarColor ?? '#6366f1' }}
                >
                  {a.displayName[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-mono font-semibold text-sm truncate">
                    {a.displayName}
                  </p>
                  <p className="text-slate-400 font-mono text-xs truncate">
                    {a.profile?.customRole}
                  </p>
                </div>
                <div
                  className={`ml-auto w-2 h-2 rounded-full flex-shrink-0 ${
                    a.lifecycleState === AgentLifecycleState.Thinking
                      ? 'bg-indigo-400 animate-wora-pulse'
                      : a.lifecycleState === AgentLifecycleState.Responding
                        ? 'bg-emerald-400'
                        : 'bg-slate-600'
                  }`}
                />
              </div>
              <p className="text-indigo-400/80 font-mono text-xs">
                {a.brainConfig?.provider} · {a.brainConfig?.model}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── MAIN WORLD ─────────────────────────────────────── */
function checkWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function World() {
  const [webGLOk, setWebGLOk] = useState<boolean | null>(null);

  useEffect(() => {
    setWebGLOk(checkWebGL());
  }, []);

  if (webGLOk === null) return null;
  return webGLOk ? <ThreeWorld /> : <FallbackWorld />;
}

function ThreeWorld() {
  const agents          = useWoraStore(useShallow((s) => Object.values(s.agents)));
  const zones           = useWoraStore(selectZones);
  const selectedAgentId = useWoraStore((s) => s.selectedAgentId);
  const selectAgent     = useWoraStore.getState().selectAgent;

  const [cameraTarget, setCameraTarget] = useState<THREE.Vector3 | null>(null);
  const [lookAtTarget, setLookAtTarget] = useState(() => new THREE.Vector3(0, 0, 0));

  useEffect(() => {
    if (!selectedAgentId) {
      setCameraTarget(new THREE.Vector3(0, 12, 18));
      setLookAtTarget(new THREE.Vector3(0, 0, 0));
      return;
    }
    const idx = agents.findIndex((a) => a.id === selectedAgentId);
    if (idx === -1) return;
    const pos = agentPosition(idx, agents.length);
    const dir = new THREE.Vector3(pos[0], 0, pos[2]).normalize();
    setCameraTarget(new THREE.Vector3(pos[0] + dir.x * 2.8, pos[1] + 3.5, pos[2] + dir.z * 2.8));
    setLookAtTarget(new THREE.Vector3(pos[0], 1.2, pos[2]));
  }, [selectedAgentId, agents]);

  const handleAgentClick = useCallback(
    (id: string) => {
      selectAgent(id === selectedAgentId ? null : id);
    },
    [selectAgent, selectedAgentId],
  );

  return (
    <Canvas
      shadows
      onPointerMissed={() => selectAgent(null)}
      camera={{ position: [0, 12, 18], fov: 48, near: 0.1, far: 300 }}
      gl={{
        antialias:                    true,
        toneMapping:                  THREE.ACESFilmicToneMapping,
        toneMappingExposure:          1.15,
        failIfMajorPerformanceCaveat: false,
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#050814']} />
      <fog attach="fog" args={['#050814', 18, 55]} />

      {/* Offline-safe studio/night lighting (no external HDR CDN dependency) */}
      <ambientLight intensity={0.28} color="#c7d2fe" />
      <hemisphereLight args={['#6366f1', '#050814', 0.45]} />
      <directionalLight
        position={[10, 22, 10]}
        intensity={0.7}
        castShadow
        color="#e0e7ff"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={70}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <pointLight position={[0, 14, 0]} intensity={0.4} color="#818cf8" />

      <Stars radius={80} depth={50} count={3500} factor={4} saturation={0.5} fade speed={0.4} />

      <Suspense fallback={null}>
        <OfficeFloor />
        <Particles />

        {zones.map((zone) => (
          <ZoneDisc key={zone.id} zone={zone} />
        ))}

        <ConnectionLines agents={agents} selectedId={selectedAgentId} />

        {agents.map((agent, i) => (
          <Workstation
            key={agent.id}
            agent={agent}
            index={i}
            total={agents.length}
            selected={agent.id === selectedAgentId}
            onClick={() => handleAgentClick(agent.id)}
          />
        ))}

        {agents.length === 0 &&
          [0, 1, 2, 3].map((i) => (
            <group key={i} position={agentPosition(i, 4)} rotation={deskRotation(i, 4)}>
              <RoundedBox args={[2.0, 0.07, 1.0]} position={[0, 0.75, 0]} radius={0.02}>
                <meshStandardMaterial
                  color="#0d0d22"
                  roughness={0.4}
                  metalness={0.6}
                  transparent
                  opacity={0.55}
                />
              </RoundedBox>
              <Html
                position={[0, 1.5, 0]}
                center
                distanceFactor={8}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  style={{
                    fontFamily:    'monospace',
                    fontSize:      '10px',
                    color:         '#44446a',
                    letterSpacing: '1px',
                  }}
                >
                  EMPTY SEAT
                </div>
              </Html>
            </group>
          ))}
      </Suspense>

      <CameraRig targetPosition={cameraTarget} targetLookAt={lookAtTarget} />
    </Canvas>
  );
}
