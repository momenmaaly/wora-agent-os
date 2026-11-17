import { useEffect } from 'react';
import { create } from 'zustand';
import { useSocket } from '../hooks/useSocket.js';
import { useWoraStore, type AgentActivityKind, type OfficeCommand } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { computeOfficePath, getAgentHomeSpot, locatePoint, OFFICE_ROOMS, ROOM_BY_ID, ROOM_SPOTS, type Point2D } from './layout.js';
import type { AgentParticipant } from '../types.js';

interface Marker extends Point2D {
  path: Point2D[];
  targetRoomId: string | null;
  activity: AgentActivityKind;
}

function at(point: Point2D): Marker {
  return { x: point.x, y: point.y, path: [], targetRoomId: null, activity: 'desk' };
}

export const useOfficeMotion = create<{
  markers: Record<string, Marker>;
  player: Marker;
  movePlayer: (target: Point2D) => void;
}>()(() => ({ markers: {}, player: at({ x: 995, y: 442 }), movePlayer: () => {} }));

function step(marker: Marker, distance: number): Marker {
  const target = marker.path[0];
  if (!target) return marker;
  const dx = target.x - marker.x;
  const dy = target.y - marker.y;
  const length = Math.hypot(dx, dy);
  if (length <= distance) {
    const path = marker.path.slice(1);
    return { ...marker, ...target, path, targetRoomId: path.length ? marker.targetRoomId : null };
  }
  return { ...marker, x: marker.x + dx / length * distance, y: marker.y + dy / length * distance };
}

const ACTIVITY_LABELS: Partial<Record<AgentActivityKind, string>> = {
  desk: 'على المكتب', meeting: 'في اجتماع', collab: 'يتعاون مع الفريق', coffee: 'في الاستراحة', board: 'يراجع العمل',
};

/** Keep the office active across page changes; only schedule frames while something is moving. */
export function useOfficeSimulation() {
  const { movePlayer } = useSocket();

  useEffect(() => {
    const motion = useOfficeMotion;
    const office = useWoraStore;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let last = 0;

    function publishLocation(agentId: string, marker: Marker) {
      const area = locatePoint(marker);
      const target = marker.targetRoomId ? ROOM_BY_ID[marker.targetRoomId] : undefined;
      const walking = marker.path.length > 0;
      office.getState().setAgentLocation(agentId, {
        areaId: area.areaId,
        areaNameAr: area.nameAr,
        targetRoomId: marker.targetRoomId,
        targetRoomNameAr: target?.nameAr ?? null,
        isWalking: walking,
        activity: walking ? 'walking' : marker.activity,
        statusTextAr: walking ? `في الطريق إلى ${target?.nameAr ?? 'المقر'}` : ACTIVITY_LABELS[marker.activity] ?? 'في القسم',
      });
    }

    function syncRoster(agents: Record<string, AgentParticipant>) {
      const old = motion.getState().markers;
      const entries = Object.values(agents).map((agent) => [agent.id, old[agent.id] ?? at(getAgentHomeSpot(agent))] as const);
      if (entries.length !== Object.keys(old).length || entries.some(([id]) => !old[id])) motion.setState({ markers: Object.fromEntries(entries) });
    }

    function tick(now: number) {
      frame = 0;
      const dt = Math.min((now - last) / 1_000, 0.045);
      last = now;
      const { markers, player } = motion.getState();
      let moving = false;
      const next = { ...markers };
      for (const [id, marker] of Object.entries(markers)) {
        if (!marker.path.length) continue;
        const updated = step(marker, 285 * dt);
        next[id] = updated;
        publishLocation(id, updated);
        moving ||= updated.path.length > 0;
      }
      const nextPlayer = step(player, 340 * dt);
      if (nextPlayer !== player && !nextPlayer.path.length) movePlayer({ x: nextPlayer.x, y: 0, z: nextPlayer.y });
      motion.setState({ markers: next, player: nextPlayer });
      if (moving || nextPlayer.path.length) frame = window.requestAnimationFrame(tick);
    }

    function start() {
      if (!frame) {
        last = performance.now();
        frame = window.requestAnimationFrame(tick);
      }
    }

    function route(agentId: string, roomId: string, spotId?: string, activity: AgentActivityKind = 'desk', origin?: Point2D) {
      const marker = motion.getState().markers[agentId];
      const target = ROOM_SPOTS.find((spot) => spot.id === spotId && spot.roomId === roomId)
        ?? ROOM_SPOTS.find((spot) => spot.roomId === roomId && spot.role === 'desk')
        ?? ROOM_SPOTS.find((spot) => spot.roomId === roomId);
      if (!marker || !target) return;
      const from = origin ?? marker;
      const path = computeOfficePath(from, target.id);
      const next = reducedMotion.matches ? { ...at(target), activity } : { ...at(from), path, targetRoomId: roomId, activity };
      motion.setState((s) => ({ markers: { ...s.markers, [agentId]: next } }));
      publishLocation(agentId, next);
      if (next.path.length) start();
    }

    function run(command: OfficeCommand | null) {
      if (!command) return;
      const agents = Object.values(office.getState().agents);
      switch (command.kind) {
        case 'dispatch-room':
          route(command.agentId, command.roomId, command.spotId, command.activity);
          break;
        case 'return-desks':
          agents.forEach((agent) => { const home = getAgentHomeSpot(agent); route(agent.id, home.roomId, home.id); });
          break;
        case 'standup': {
          const boardroom = useBillingStore.getState().plan === 'pro';
          const roomId = boardroom ? 'zone-boardroom' : 'zone-lounge';
          const seats = ROOM_SPOTS.filter((spot) => spot.roomId === roomId && (boardroom ? spot.role === 'meeting' : spot.role !== 'reception'));
          agents.forEach((agent, index) => route(agent.id, roomId, seats[index % seats.length]?.id, 'meeting'));
          break;
        }
        case 'spawn-at-reception': {
          const reception = ROOM_SPOTS.find((spot) => spot.role === 'reception');
          route(command.agentId, command.homeRoomId, undefined, 'desk', reception);
          break;
        }
        case 'handoff': {
          const from = agents.find((agent) => agent.id === command.fromAgentId) ?? agents[0];
          const to = agents.find((agent) => agent.id === command.toAgentId) ?? agents.find((agent) => agent.id !== from?.id);
          if (!from || !to || from.id === to.id) break;
          const roomId = getAgentHomeSpot(to).roomId;
          const desk = ROOM_SPOTS.find((spot) => spot.roomId === roomId && spot.role === 'collab');
          route(from.id, roomId, desk?.id, 'collab');
          break;
        }
      }
    }

    syncRoster(office.getState().agents);
    const unsubscribeAgents = office.subscribe((s) => s.agents, syncRoster);
    const unsubscribeCommands = office.subscribe((s) => s.officeCommand, run);
    motion.setState({ movePlayer: (target) => {
      const area = locatePoint(target);
      if (area.isRoom || area.areaId === 'campus') return;
      const player = motion.getState().player;
      if (reducedMotion.matches) {
        motion.setState({ player: at(target) });
        movePlayer({ x: target.x, y: 0, z: target.y });
      } else {
        motion.setState({ player: { ...player, path: computeOfficePath(player, target) } });
        start();
      }
    } });

    const roaming = window.setInterval(() => {
      if (!office.getState().ui.autoRoam || reducedMotion.matches || document.hidden) return;
      const { markers } = motion.getState();
      const available = Object.values(office.getState().agents).filter((agent) => !markers[agent.id]?.path.length && agent.lifecycleState === 'IDLE');
      const agent = available[Math.floor(Math.random() * available.length)];
      if (!agent) return;
      const rooms = OFFICE_ROOMS.filter((r) => !isRoomLockedForPlan(r.id, useBillingStore.getState().plan) && r.id !== office.getState().agentLocations[agent.id]?.areaId);
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      if (room) route(agent.id, room.id, undefined, room.kind === 'lounge' ? 'coffee' : 'collab');
    }, 9_000);

    return () => {
      unsubscribeAgents();
      unsubscribeCommands();
      window.clearInterval(roaming);
      window.cancelAnimationFrame(frame);
      motion.setState({ movePlayer: () => {} });
    };
  }, [movePlayer]);
}
