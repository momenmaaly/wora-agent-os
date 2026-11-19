import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import {
  OFFICE_WORLD, ROOM_3D_BY_ID, agentCurrentTask, agentSpot, agentVisualState, buildRoomLayouts, spotToWorld,
} from '../src/three/layout.ts';
import { ROOM_SPOTS } from '../src/office/layout.ts';

const agent = (extras = {}) => ({
  id: 'agent-test',
  displayName: 'Test',
  isHuman: false,
  isAgent: true,
  origin: 'INTERNAL',
  zoneId: 'zone-engineering',
  lifecycleState: 'IDLE',
  socketId: null,
  assignedRoomIds: [],
  modelId: 'gemini-2.5-flash',
  activeTasks: 0,
  brainConfig: { provider: 'google', model: 'gemini-2.5-flash' },
  avatarState: 'idle',
  locale: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  status: 'ONLINE',
  activeRoomIds: [],
  profile: { customRole: 'Engineer', tone: 'Concise', skills: [], avatarColor: '#000' },
  ...extras,
});

const task = (status, extras = {}) => ({
  id: 'task-1', roomId: 'room', zoneId: 'zone-engineering', type: 'task', status,
  authorAgentId: 'owner', targetAgentId: 'agent-test', title: 'A recorded task', payload: {},
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', chainIds: [], ...extras,
});

test('the 3D layout preserves all ten existing departments around the central lobby', () => {
  const rooms = buildRoomLayouts();
  equal(rooms.length, 10);
  equal(new Set(rooms.map((room) => room.id)).size, 10);
  equal(rooms.filter((room) => room.row === 'north').length, 5);
  equal(rooms.filter((room) => room.row === 'south').length, 5);
  ok(ROOM_3D_BY_ID['zone-boardroom']);
  for (const room of rooms) {
    ok(Math.abs(room.centerX) + room.width / 2 <= OFFICE_WORLD.slabWidth / 2, room.id);
    ok(Math.abs(room.centerZ) + room.depth / 2 <= OFFICE_WORLD.slabDepth / 2, room.id);
    ok(room.width > 2 && room.depth > 4, room.id);
  }
  const north = rooms.find((room) => room.id === 'zone-engineering');
  const south = rooms.find((room) => room.id === 'zone-marketing');
  ok(north && south);
  ok(north.centerZ < -OFFICE_WORLD.lobbyRadius && south.centerZ > OFFICE_WORLD.lobbyRadius);
});

test('preserved workstation spots map inside their 3D department bounds', () => {
  for (const spot of ROOM_SPOTS) {
    const room = ROOM_3D_BY_ID[spot.roomId];
    const point = spotToWorld(spot);
    ok(room, spot.id);
    ok(Math.abs(point.x - room.centerX) <= room.width / 2, spot.id);
    ok(Math.abs(point.z - room.centerZ) <= room.depth / 2, spot.id);
  }
  const occupied = new Set(['eng-desk']);
  const first = agentSpot('agent-a', 'zone-engineering', occupied);
  const second = agentSpot('agent-b', 'zone-engineering', new Set([...occupied, first.spotId].filter(Boolean)));
  ok(!first.spotId || first.spotId !== second.spotId);
});

test('robot states are derived from real lifecycle and recorded task status, not timers', () => {
  equal(agentVisualState(agent(), []), 'idle');
  equal(agentVisualState(agent({ lifecycleState: 'EXECUTING' }), []), 'working');
  equal(agentVisualState(agent({ lifecycleState: 'RESPONDING' }), []), 'communicating');
  equal(agentVisualState(agent({ lifecycleState: 'ERROR' }), []), 'blocked');
  equal(agentVisualState(agent({ status: 'OFFLINE' }), []), 'offline');
  equal(agentVisualState(agent(), [task('review_pending')]), 'reviewing');
  equal(agentVisualState(agent(), [task('approved')]), 'completed');
  equal(agentVisualState(agent(), [task('open')]), 'working');
  const fixture = task('done', { payload: { sample: true } });
  equal(agentVisualState(agent(), [fixture]), 'idle', 'sample fixtures never drive productivity');
  equal(agentCurrentTask('agent-test', [fixture])?.id, undefined);
  deepEqual(agentCurrentTask('agent-test', [task('open')])?.status, 'open');
});
