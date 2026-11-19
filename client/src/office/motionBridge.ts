import type { OfficeMotionMarker } from './useOfficeSimulation.ts';
import { planPointToWorld, type WorldPoint } from '../three/layout.ts';

export interface WorldMotionFrame {
  positions: Record<string, WorldPoint>;
  movement: Set<string>;
  authorized: Set<string>;
}

/**
 * Converts the existing 2D company navigation plan into WebGL coordinates.
 * Only markers carrying a real command sequence may move a 3D robot. Automatic
 * idle roaming remains available in the preserved SVG workspace but is never
 * presented in 3D as if it were an execution event.
 */
export function motionMarkersToWorld(markers: Record<string, OfficeMotionMarker>): WorldMotionFrame {
  const positions: Record<string, WorldPoint> = {};
  const movement = new Set<string>();
  const authorized = new Set<string>();
  for (const [agentId, marker] of Object.entries(markers)) {
    if (!marker || marker.commandSeq <= 0) continue;
    authorized.add(agentId);
    positions[agentId] = planPointToWorld(marker.x, marker.y);
    if (marker.path.length > 0) movement.add(agentId);
  }
  return { positions, movement, authorized };
}
