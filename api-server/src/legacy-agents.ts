/**
 * Authenticated legacy agent roster.
 *
 * The socket and AI queue keep using the in-process `loadActiveAgents` cache;
 * this HTTP surface is only for authenticated clients. A normal member sees
 * agents assigned to their own `wora-{userId}` room; admins/owners and the
 * explicit admin API key may see the full active roster.
 */
import type { RequestHandler } from 'express';
import { safeEqual, verifySessionToken } from './lib/session.js';
import type { WorkspaceRole } from './os/roles.js';

export interface LegacyAgentView {
  agentId: string;
  displayName: string;
  locale: string;
  zoneId: string | null;
  modelId: string;
  brainConfig: unknown;
  profile: unknown;
  status: string;
  lastSeenAt?: unknown;
  assignedRoomIds?: string[];
  [key: string]: unknown;
}

export interface LegacyAgentsDeps {
  authSecret: string;
  isProduction: boolean;
  adminApiKey?: string;
  loadActiveAgents: () => Promise<LegacyAgentView[]>;
  isSessionActive: (sessionId: string, userId: string) => boolean;
  getWorkspaceRole: (workspaceId: string, userId: string) => WorkspaceRole;
}

export function createLegacyAgentsHandler(deps: LegacyAgentsDeps): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!deps.authSecret) {
      res.status(503).json({ code: 'AUTH_UNAVAILABLE' });
      return;
    }
    const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const adminKey = req.header('x-api-key') ?? '';
    const admin = Boolean(deps.adminApiKey && ((bearer && safeEqual(bearer, deps.adminApiKey)) || (adminKey && safeEqual(adminKey, deps.adminApiKey))));
    let userId: string | null = null;
    if (!admin) {
      const session = bearer ? verifySessionToken(bearer, deps.authSecret, deps.isProduction) : null;
      if (!session) {
        res.status(401).json({ code: 'AUTH_REQUIRED' });
        return;
      }
      if (session.sessionId) {
        try {
          if (!deps.isSessionActive(session.sessionId, session.userId)) {
            res.status(401).json({ code: 'SESSION_REVOKED' });
            return;
          }
        } catch {
          res.status(503).json({ code: 'SESSION_STORE_UNAVAILABLE' });
          return;
        }
      }
      userId = session.userId;
    }
    try {
      const agents = await deps.loadActiveAgents();
      if (admin || !userId) {
        res.json({ agents });
        return;
      }
      const roomId = `wora-${userId}`;
      const role = deps.getWorkspaceRole(roomId, userId);
      const visible = role === 'admin' || role === 'owner'
        ? agents
        : agents.filter((agent) => (agent.assignedRoomIds ?? []).includes(roomId));
      res.json({ agents: visible });
    } catch {
      res.status(503).json({ code: 'AGENT_ROSTER_UNAVAILABLE' });
    }
  };
}
