/**
 * wora-server.ts — Wora Agent OS v4.1 (Production-Hardened 2026)
 * ───────────────────────────────────────────────────────────────
 * Core architecture & security guarantees:
 *  1. Fixed ESM relative imports (`../../shared/types/index.js`).
 *  2. Safe environment variable sanitization (preserves query strings in URIs).
 *  3. Strict CORS origin allowlist (`ALLOWED_ORIGINS`) + expiring signed production sessions.
 *  4. Full Zod validation on every REST route & Socket.IO event (400 on ZodError).
 *  5. Distributed Redis rate limiting across instances on all mutating socket events.
 *  6. Strict per-user room isolation (`wora-{userId}`):
 *     - Room-scoped workspace entries via SharedWorkspaceManager
 *     - Room-scoped brain hot-swaps stored in Redis (no cross-user hijacking)
 *     - Room-scoped persistent chat history in Redis (contextual LLM memory)
 *  7. Cross-instance BrainAdapterFactory cache invalidation via Redis Pub/Sub.
 *  8. Zero secret leakage into BullMQ/Redis + Unicode/Arabic @mention support.
 *  9. Live `/health` probes + complete graceful shutdown (`SIGTERM` & `SIGINT`).
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient as createRedis, type RedisClientType } from 'redis';
import cors, { type CorsOptions } from 'cors';
import mongoose from 'mongoose';
import { z, ZodError } from 'zod';

import { AgentModel, type IAgentDocument } from './models/Agent.js';
import { SharedWorkspaceManager } from './core/SharedWorkspaceManager.js';
import { workspaceSignalSchema, type AssignmentAck, type ReplyToAssignment } from './core/taskSignal.js';
import { chooseWithModel, createDirectorRecommender, type DirectorRecommendation } from './director/recommend.js';
import {
  BrainAdapterFactory,
  isProviderConfigured,
  isSupportedModel,
  type ConversationTurn,
} from './ai/BrainAdapter.js';
import { AiQueue } from './queue/AiQueue.js';
import { PresenceStore } from './store/PresenceStore.js';
import { AgentRuntimeStore } from './store/AgentRuntimeStore.js';
import { EXAMPLE_ZONES, VALID_ZONE_IDS } from './zones.js';
import { logger } from './lib/logger.js';
import { safeEqual, verifySessionToken } from './lib/session.js';
import { configuredOrigins, isProductionEnv, productionConfigProblems, sanitizeEnv } from './lib/config.js';
import { generateStudioPack, resolveStudioBrain } from './studio/drafts.js';
import { createStudioRouter } from './studio/router.js';
import { createOsRouter } from './os/router.js';
import { createGitHubImporter } from './skills/github.js';
import { createSkillsRouter } from './skills/router.js';
import { createMongoSkillStore } from './models/AgentSkills.js';
import { initExtensions } from './extensions/index.js';

import {
  AgentLifecycleState,
  AgentOrigin,
  AvatarAnimState,
  BrainProvider,
  BRAIN_MODELS,
  BRAIN_PROVIDER_LABELS,
  DEFAULT_BRAIN_MODEL,
  MessageType,
  ParticipantStatus,
  RoomAccessMode,
  lifecycleToAvatarState,
} from '../../shared/types/index.js';
import type {
  AgentParticipant,
  BrainSwapBroadcast,
  Message,
  PublicBrainConfig,
} from '../../shared/types/index.js';

const IS_PRODUCTION  = isProductionEnv(process.env);
const NODE_ENV       = IS_PRODUCTION ? 'production' : 'development';
const DEFAULT_PORT   = Number(process.env['PORT'] ?? 4000);
const MONGO_URI      = sanitizeEnv(process.env['MONGO_URI']);
const REDIS_URL      = sanitizeEnv(process.env['REDIS_URL']) ?? 'redis://localhost:6379';
const MAX_SOCKETS    = Math.max(10, Number(process.env['MAX_SOCKETS'] ?? 12_000));
const AUTH_SECRET    = sanitizeEnv(process.env['AUTH_SECRET']);
const ADMIN_API_KEY  = sanitizeEnv(process.env['ADMIN_API_KEY']);

const BRAIN_EVICT_CHANNEL   = 'wora:events:brain-evict';
const skillChannel = (roomId: string) => `skills:${roomId}`;
const ROOM_HISTORY_LIMIT    = 100;
const AI_CONTEXT_TURNS      = 16;
const ROOM_DATA_TTL_SECONDS = 86_400 * 7; // 7 days
const MAX_MENTIONS_PER_MSG  = 3;
const AGENT_CACHE_TTL_MS    = 30_000;

/* ─── CORS CONFIGURATION ────────────────────────────────── */
const allowedOrigins = new Set(configuredOrigins(process.env['ALLOWED_ORIGINS']));
function allowOrigin(origin?: string) {
  // Non-browser requests still have to present a signed session for workspace access.
  return !origin || allowedOrigins.has(origin) || (!IS_PRODUCTION && !allowedOrigins.size
    && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
}

function buildCorsOptions(): CorsOptions {
  return {
    origin(origin, callback) {
      if (allowOrigin(origin)) callback(null, true);
      else callback(new Error('CORS_ORIGIN_DENIED'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
    maxAge: 86_400,
  };
}

async function within<T>(pending: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Operation timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/* ─── AUTH HELPERS ──────────────────────────────────────── */
function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    if (IS_PRODUCTION) {
      res.status(403).json({ error: 'ADMIN_API_KEY is required in production for this endpoint' });
      return;
    }
    next();
    return;
  }
  const header = req.header('x-api-key') ?? req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!header || !safeEqual(header, ADMIN_API_KEY)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function requireRoomAccess(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  const roomId = req.params['roomId'] ?? '';
  if (!AUTH_SECRET) {
    if (IS_PRODUCTION) { res.status(503).json({ code: 'AUTH_UNAVAILABLE' }); return; }
    next();
    return;
  }
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (ADMIN_API_KEY && bearer && safeEqual(bearer, ADMIN_API_KEY)) {
    next();
    return;
  }
  const verified = bearer ? verifySessionToken(bearer, AUTH_SECRET, IS_PRODUCTION) : null;
  if (!verified || roomId !== `wora-${verified.userId}`) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

/* ─── ZOD VALIDATION SCHEMAS ────────────────────────────── */
const SafeIdSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const RoomIdSchema = z.string().trim().min(1).max(100).regex(/^wora-[a-zA-Z0-9_-]+$/);

const PositionSchema = z.object({
  x: z.number().finite().min(-500).max(500),
  y: z.number().finite().min(-100).max(100),
  z: z.number().finite().min(-500).max(500),
});

const PublicBrainSchema = z
  .object({
    provider:    z.enum(BrainProvider),
    model:       z.string().trim().min(1).max(100),
    maxTokens:   z.number().int().min(64).max(16_384).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict()
  .refine((cfg) => isSupportedModel(cfg.provider, cfg.model), {
    message: 'Model is not supported for the selected provider',
    path:    ['model'],
  });

const RestBrainSwapSchema = z
  .object({
    provider:    z.enum(BrainProvider),
    model:       z.string().trim().min(1).max(100),
    maxTokens:   z.number().int().min(64).max(16_384).optional(),
    temperature: z.number().min(0).max(2).optional(),
    requestedBy: z.string().trim().min(1).max(80).optional(),
    reason:      z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((cfg) => isSupportedModel(cfg.provider, cfg.model), {
    message: 'Model is not supported for the selected provider',
    path:    ['model'],
  });

const SocketBrainSwapSchema = z.object({
  agentId:     SafeIdSchema,
  newBrain:    PublicBrainSchema,
  requestedBy: z.string().trim().max(80).optional(),
  reason:      z.string().trim().max(500).optional(),
});

const RoomJoinSchema = z
  .object({
    roomId:   z.string().max(100).optional(),
    position: PositionSchema.optional(),
  })
  .default({});

const RoomMoveSchema = z.object({
  roomId:   z.string().max(100).optional(),
  position: PositionSchema,
});

const MessageSendSchema = z.object({
  roomId:        z.string().max(100).optional(),
  content:       z.string().trim().min(1).max(4_000),
  type:          z.enum([MessageType.Text, MessageType.Mention]).default(MessageType.Text),
  replyToId:     z.string().uuid().optional(),
  targetAgentId: SafeIdSchema.optional(),
});

const WorkspaceWriteSchema = z.object({
  zoneId:        SafeIdSchema.refine((id) => VALID_ZONE_IDS.has(id), 'Unknown zoneId'),
  type:          z.enum(['task', 'artifact', 'review', 'signal', 'handoff']),
  authorAgentId: SafeIdSchema,
  targetAgentId: SafeIdSchema.optional(),
  title:         z.string().trim().min(1).max(200),
  payload:       z.record(z.string().max(64), z.unknown()).default({}),
  parentEntryId: z.string().uuid().optional(),
  expiresInMs:   z.number().int().min(5_000).max(86_400_000 * 7).optional(),
});

/* ─── DISTRIBUTED REDIS RATE LIMITER ────────────────────── */
const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`;

class RedisRateLimiter {
  constructor(private readonly redis: RedisClientType) {}

  async allow(bucket: string, subject: string, limit: number, windowMs: number, quotaSignal?: AbortSignal): Promise<boolean> {
    const key = `wora:rl:${bucket}:${subject}`;
    try {
      const client = quotaSignal ? this.redis.withCommandOptions({ abortSignal: quotaSignal, timeout: 1_500 }) : this.redis;
      if (quotaSignal && !this.redis.isReady) throw new Error('Quota storage unavailable');
      const count = Number(
        await client.eval(RATE_LIMIT_LUA, {
          keys:      [key],
          arguments: [String(windowMs)],
        }),
      );
      return count <= limit;
    } catch (error) {
      // Interactive actions preserve availability; metered provider calls fail closed.
      if (quotaSignal) throw error;
      return true;
    }
  }
}

/* ─── ROOM STATE HELPERS (CHAT HISTORY & BRAIN OVERRIDES) ── */
function roomMessagesKey(roomId: string): string {
  return `wora:room:${roomId}:messages`;
}

function roomBrainsKey(roomId: string): string {
  return `wora:room:${roomId}:brains`;
}

async function appendRoomMessage(redis: RedisClientType, roomId: string, msg: Message): Promise<void> {
  const key = roomMessagesKey(roomId);
  const multi = redis.multi();
  multi.rPush(key, JSON.stringify(msg));
  multi.lTrim(key, -ROOM_HISTORY_LIMIT, -1);
  multi.expire(key, ROOM_DATA_TTL_SECONDS);
  await multi.exec();
}

async function getRoomMessages(redis: RedisClientType, roomId: string, count = ROOM_HISTORY_LIMIT): Promise<Message[]> {
  const raw = await redis.lRange(roomMessagesKey(roomId), -count, -1);
  const out: Message[] = [];
  for (const item of raw) {
    try {
      out.push(JSON.parse(item) as Message);
    } catch {
      // Skip malformed entry
    }
  }
  return out;
}

async function setRoomBrainOverride(
  redis: RedisClientType,
  roomId: string,
  agentId: string,
  brain: PublicBrainConfig,
): Promise<void> {
  const key = roomBrainsKey(roomId);
  const multi = redis.multi();
  multi.hSet(key, agentId, JSON.stringify(brain));
  multi.expire(key, ROOM_DATA_TTL_SECONDS);
  await multi.exec();
}

async function getRoomBrainOverrides(
  redis: RedisClientType,
  roomId: string,
): Promise<Record<string, PublicBrainConfig>> {
  const raw = await redis.hGetAll(roomBrainsKey(roomId));
  const out: Record<string, PublicBrainConfig> = {};
  for (const [agentId, json] of Object.entries(raw)) {
    try {
      const parsed = PublicBrainSchema.safeParse(JSON.parse(json));
      if (parsed.success) out[agentId] = parsed.data;
    } catch {
      // Ignore invalid override
    }
  }
  return out;
}

function toPublicBrain(cfg?: Partial<PublicBrainConfig>, fallbackModel?: string): PublicBrainConfig {
  const provider = cfg?.provider ?? BrainProvider.Google;
  const model = cfg?.model ?? fallbackModel ?? DEFAULT_BRAIN_MODEL;
  return {
    provider,
    model,
    ...(cfg?.maxTokens !== undefined ? { maxTokens: cfg.maxTokens } : {}),
    ...(cfg?.temperature !== undefined ? { temperature: cfg.temperature } : {}),
  };
}

/* ─── UNICODE-AWARE MENTION PARSER ──────────────────────── */
interface ParsedMention {
  token:      string;
  raw:        string;
  startIndex: number;
  endIndex:   number;
}

function extractUniqueMentions(content: string, max = MAX_MENTIONS_PER_MSG): ParsedMention[] {
  const regex = /@([\p{L}\p{N}_-]{2,40})/gu;
  const seen = new Set<string>();
  const results: ParsedMention[] = [];

  for (const match of content.matchAll(regex)) {
    const token = match[1]?.toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const startIndex = match.index ?? 0;
    results.push({
      token,
      raw:      match[0],
      startIndex,
      endIndex: startIndex + match[0].length,
    });
    if (results.length >= max) break;
  }

  return results;
}

function matchAgentByMention(agents: readonly CachedAgent[], token: string): CachedAgent | undefined {
  const normalized = token.toLowerCase();
  // 1. Exact match on agentId or displayName
  const exact = agents.find(
    (a) => a.agentId.toLowerCase() === normalized || a.displayName.toLowerCase() === normalized,
  );
  if (exact) return exact;

  // 2. First-word or prefix match on displayName (min 3 chars to avoid accidental `@a` matches)
  if (normalized.length >= 3) {
    return agents.find((a) => {
      const lowerName = a.displayName.toLowerCase();
      const firstWord = lowerName.split(/\s+/)[0] ?? '';
      return firstWord === normalized || lowerName.startsWith(normalized);
    });
  }
  return undefined;
}

type CachedAgent = Pick<
  IAgentDocument,
  | 'agentId'
  | 'displayName'
  | 'locale'
  | 'modelId'
  | 'brainConfig'
  | 'avatarGlb'
  | 'avatarUrl'
  | 'zoneId'
  | 'assignedRoomIds'
  | 'profile'
  | 'systemPromptOverride'
  | 'status'
  | 'activeTasks'
  | 'createdAt'
  | 'lastSeenAt'
>;

function mapAgentToParticipant(
  agent: CachedAgent,
  roomId: string,
  brainOverride?: PublicBrainConfig,
): AgentParticipant {
  const effectiveBrain = brainOverride ?? toPublicBrain(agent.brainConfig, agent.modelId);
  return {
    id:              agent.agentId,
    displayName:     agent.displayName,
    isHuman:         false,
    isAgent:         true,
    origin:          AgentOrigin.Internal,
    profile: {
      customRole:       agent.profile.customRole,
      tone:             agent.profile.tone,
      skills:           agent.profile.skills ?? [],
      avatarColor:      agent.profile.avatarColor,
      tagline:          agent.profile.tagline,
      specialty:        agent.profile.specialty,
      boundaries:       agent.profile.boundaries,
      colleagues:       agent.profile.colleagues,
      knowledgeBaseIds: agent.profile.knowledgeBaseIds,
    },
    zoneId:          agent.zoneId ?? null,
    lifecycleState:  AgentLifecycleState.Idle,
    socketId:        null,
    assignedRoomIds: agent.assignedRoomIds ?? [],
    modelId:         effectiveBrain.model,
    activeTasks:     agent.activeTasks ?? 0,
    brainConfig:     effectiveBrain,
    avatarGlb:       agent.avatarGlb,
    avatarState:     AvatarAnimState.Idle,
    locale:          agent.locale ?? 'en',
    createdAt:       agent.createdAt ? new Date(agent.createdAt).toISOString() : new Date().toISOString(),
    lastSeenAt:      agent.lastSeenAt ? new Date(agent.lastSeenAt).toISOString() : new Date().toISOString(),
    status:          agent.status === 'active' ? ParticipantStatus.Online : ParticipantStatus.Offline,
    activeRoomIds:   [roomId],
    avatarUrl:       agent.avatarUrl,
  };
}

/* ─── BOOT SERVER ───────────────────────────────────────── */
export async function bootWoraServer(app: Express, port = DEFAULT_PORT) {
  initExtensions();
  const problems = productionConfigProblems(process.env);
  if (problems.length) throw new Error(`Missing or invalid production configuration: ${problems.join(', ')}`);
  const httpServer = createServer(app);
  const corsOptions = buildCorsOptions();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!allowOrigin(_req.get('Origin'))) { res.status(403).json({ code: 'CORS_ORIGIN_DENIED' }); return; }
    next();
  });
  app.use(cors(corsOptions));

  /* ── Redis clients (pub + sub + app events) ── */
  const pubClient = createRedis({ url: REDIS_URL, disableOfflineQueue: true }) as RedisClientType;
  const subClient = pubClient.duplicate() as RedisClientType;
  const eventSub  = pubClient.duplicate() as RedisClientType;

  pubClient.on('error', (err: Error) => logger.error({ err: err.message }, 'Redis pubClient error'));
  subClient.on('error', (err: Error) => logger.error({ err: err.message }, 'Redis subClient error'));
  eventSub.on('error',  (err: Error) => logger.error({ err: err.message }, 'Redis eventSub error'));

  await within(Promise.all([pubClient.connect(), subClient.connect(), eventSub.connect()]), 10_000);
  logger.info('Redis clients connected');

  // Cross-instance BrainAdapterFactory cache invalidation
  let agentsCache: { data: CachedAgent[]; expiresAt: number } | null = null;
  const invalidateLocalAgentCache = (agentId?: string) => {
    agentsCache = null;
    if (agentId) BrainAdapterFactory.swapBrain(agentId);
  };

  await eventSub.subscribe(BRAIN_EVICT_CHANNEL, (agentId) => {
    invalidateLocalAgentCache(agentId);
  });

  const presence = new PresenceStore(pubClient);
  const runtime = new AgentRuntimeStore(pubClient);
  const rateLimiter = new RedisRateLimiter(pubClient);

  /* ── Socket.IO with Redis adapter ── */
  const io = new SocketIOServer(httpServer, {
    cors:            corsOptions,
    allowRequest:    (req, done) => done(null, allowOrigin(req.headers.origin)),
    transports:      ['websocket', 'polling'],
    pingInterval:    25_000,
    pingTimeout:     60_000,
    connectTimeout:  10_000,
    maxHttpBufferSize: 32_768, // 32 KB max socket frame
    path:            '/socket.io',
  });
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('Socket.IO Redis adapter configured');

  /* ── MongoDB connection with live state tracking ── */
  const isMongoReady = () => mongoose.connection.readyState === 1;

  if (MONGO_URI) {
    mongoose.connection.on('connected',    () => logger.info('MongoDB connected'));
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('error',        (err: Error) => logger.error({ err: err.message }, 'MongoDB error'));

    await mongoose.connect(MONGO_URI, {
      maxPoolSize:              50,
      minPoolSize:              5,
      serverSelectionTimeoutMS: 8_000,
      socketTimeoutMS:          45_000,
      appName:                  'wora-agent-os',
    });
  } else {
    logger.warn('MONGO_URI is not set — starting without persistent agent catalog');
  }

  /* ── Shared Workspace Manager (reuses pubClient, works with or without Mongo) ── */
  const workspaceMgr = await SharedWorkspaceManager.create(io, pubClient);

  /* ── Cached active agent loader (avoids hitting MongoDB on every join/message) ── */
  async function loadActiveAgents(): Promise<CachedAgent[]> {
    if (!isMongoReady()) return [];
    const now = Date.now();
    if (agentsCache && now < agentsCache.expiresAt) {
      return agentsCache.data;
    }
    const docs = await AgentModel.find({ status: 'active' }, null, { maxTimeMS: 2_500 }).lean<CachedAgent[]>();
    if (docs.length) agentsCache = { data: docs, expiresAt: now + AGENT_CACHE_TTL_MS };
    return docs;
  }

  /* ── AI Queue (BullMQ) with reply persistence ── */
  const aiQueue = new AiQueue(io, REDIS_URL, {
    onLifecycle(job, state, ttl) {
      void runtime.report(job.roomId, job.agentId, job.messageId, state, ttl)
        .then((event) => io.to(event.roomId).emit('agent:lifecycle', event))
        .catch(() => logger.warn('Agent runtime signal could not be saved'));
    },
    async onWorkspaceProgress(job, progress) {
      if (!job.workspaceTask) return false;
      const { zoneId, entryId } = job.workspaceTask;
      const status = progress.state === 'started' ? 'in_progress' : progress.state === 'response' ? 'review_pending' : 'open';
      const payload = progress.state === 'response' ? { directorExecution: 'ready', directorResponse: progress.text }
        : progress.state === 'failed' ? { directorExecution: 'failed' } : undefined;
      return Boolean(await workspaceMgr.updateStatus(zoneId, job.roomId, entryId, status, payload));
    },
    onReplyPersisted: async (roomId, replyMsg, agentId) => {
      await appendRoomMessage(pubClient, roomId, replyMsg);
      if (isMongoReady()) {
        AgentModel.updateOne(
          { agentId },
          { $inc: { totalTasksRun: 1 }, $set: { lastSeenAt: new Date() } },
        ).catch(() => {});
      }
    },
  });

  /* ── Socket connection & authentication middleware ── */
  let connectionCount = 0;

  io.use((socket, next) => {
    if (connectionCount >= MAX_SOCKETS) {
      next(new Error('SERVER_FULL'));
      return;
    }

    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const rawToken = typeof auth?.['token'] === 'string' ? auth['token'].trim() : '';

    if (AUTH_SECRET) {
      if (!rawToken) {
        next(new Error('AUTH_REQUIRED'));
        return;
      }
      const verified = verifySessionToken(rawToken, AUTH_SECRET, IS_PRODUCTION);
      if (!verified) {
        next(new Error('AUTH_INVALID'));
        return;
      }
      socket.data['userId']      = verified.userId;
      socket.data['displayName'] = verified.displayName ?? 'User';
      socket.data['sessionExpiresAt'] = verified.expiresAt;
      next();
      return;
    }

    if (IS_PRODUCTION) { next(new Error('AUTH_UNAVAILABLE')); return; }
    // Unsigned identities are supported only in explicitly enabled local development.
    const rawUserId = typeof auth?.['userId'] === 'string' ? auth['userId'].trim() : '';
    const safeUserId = /^[a-zA-Z0-9_-]{4,64}$/.test(rawUserId)
      ? rawUserId
      : `user-${randomUUID().slice(0, 12)}`;
    const rawName = typeof auth?.['displayName'] === 'string' ? auth['displayName'].trim().slice(0, 50) : '';

    socket.data['userId']      = safeUserId;
    socket.data['displayName'] = rawName || 'User';
    next();
  });

  /* ─── REST API ROUTES ──────────────────────────────────── */
  const studioSecret = AUTH_SECRET;
  const studioProvider = sanitizeEnv(process.env['STUDIO_PROVIDER']);
  const studioBrain = studioSecret ? resolveStudioBrain(studioProvider, sanitizeEnv(process.env['STUDIO_MODEL'])) : null;
  if (studioProvider && !studioBrain) {
    logger.warn('Live Studio is disabled: check session authentication and the Studio provider/model settings');
  }
  app.use('/api/studio', createStudioRouter(studioSecret && studioBrain ? {
    authenticate(authorization) {
      const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
      return token ? verifySessionToken(token, studioSecret, true)?.userId ?? null : null;
    },
    async consumeQuota(userId, signal) {
      if (!await rateLimiter.allow('studio-user', userId, 4, 60_000, signal)) return 60;
      if (!await rateLimiter.allow('studio-global', 'workspace', 60, 3_600_000, signal)) return 3_600;
      return null;
    },
    generate: (brief, signal) => generateStudioPack(studioBrain, brief, signal),
  } : undefined));
  const recommendDirector = studioSecret && studioBrain ? createDirectorRecommender({
    getAgents: loadActiveAgents,
    async consumeQuota(userId, signal) {
      return await rateLimiter.allow('director-user', userId, 6, 60_000, signal)
        && await rateLimiter.allow('director-global', 'workspace', 90, 3_600_000, signal);
    },
    choose: (brief, candidates, signal) => chooseWithModel(studioBrain, brief, candidates, signal),
  }) : null;
  const skillStore = createMongoSkillStore();
  const githubToken = sanitizeEnv(process.env['GITHUB_SKILLS_TOKEN']);
  app.use('/api/agents/:agentId/skills', createSkillsRouter({
    available: () => Boolean(AUTH_SECRET && isMongoReady()),
    authenticate(token) {
      const session = AUTH_SECRET && verifySessionToken(token, AUTH_SECRET, true);
      return session ? { userId: session.userId, roomId: `wora-${session.userId}` } : null;
    },
    async hasAgent(_roomId, agentId) {
      return Boolean(await AgentModel.exists({ agentId, status: 'active' }).maxTimeMS(2_500));
    },
    async consumeQuota(kind, userId, signal) {
      if (!await rateLimiter.allow(`skills-${kind}-user`, userId, kind === 'import' ? 4 : 20, 60_000, signal)) return 60;
      if (kind === 'import' && !await rateLimiter.allow('skills-import-global', 'github', githubToken ? 100 : 16, 3_600_000, signal)) return 3_600;
      return null;
    },
    importGitHub: createGitHubImporter({ token: githubToken }),
    store: skillStore,
    publish: (event) => io.to(skillChannel(event.roomId)).emit('agent:skills-updated', event),
  }));
  app.use('/api/os', createOsRouter());
  app.use(express.json({ limit: '16kb' }));

  const serverMode = IS_PRODUCTION ? 'production' : 'development';
  async function redisResponds() {
    if (!pubClient.isReady) return false;
    try { return await pubClient.withCommandOptions({ abortSignal: AbortSignal.timeout(1_200) }).ping() === 'PONG'; }
    catch { return false; }
  }

  app.get('/health', async (_req: Request, res: Response) => {
    const redisOk = await redisResponds();
    const mongoStatus = !MONGO_URI ? 'not_configured' : isMongoReady() ? 'connected' : 'disconnected';
    const healthy = redisOk && (mongoStatus === 'connected' || (!IS_PRODUCTION && mongoStatus === 'not_configured'));
    res.setHeader('Cache-Control', 'no-store');
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded', mode: serverMode, version: 'v4.1-scaled',
      connections: connectionCount, maxSockets: MAX_SOCKETS,
      mongodb: mongoStatus, redis: redisOk ? 'connected' : 'disconnected',
      queue: redisOk ? await within(aiQueue.getStats(), 1_200).catch(() => null) : null,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    const redisOk = await redisResponds();
    const mongoOk = isMongoReady();
    const agents = mongoOk ? await within(loadActiveAgents(), 2_600).catch(() => null) : null;
    const ready = redisOk && mongoOk && Boolean(AUTH_SECRET && agents?.length);
    const hasProvider = agents?.some((agent) => isProviderConfigured(agent.brainConfig ?? { provider: BrainProvider.Google }));
    res.setHeader('Cache-Control', 'no-store');
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready', mode: serverMode,
      redis: redisOk ? 'connected' : 'disconnected', mongodb: mongoOk ? 'connected' : 'disconnected',
      sessions: AUTH_SECRET ? 'signed' : 'unconfigured',
      roster: agents === null ? 'unavailable' : agents.length ? 'seeded' : 'unseeded',
      ai: hasProvider ? 'configured' : 'unconfigured',
    });
  });

  app.get('/api/session', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!AUTH_SECRET) { res.status(404).json({ code: 'AUTH_UNAVAILABLE' }); return; }
    const token = req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) { res.status(401).json({ code: 'AUTH_REQUIRED' }); return; }
    const session = verifySessionToken(token, AUTH_SECRET, true);
    if (!session) { res.status(401).json({ code: 'AUTH_INVALID' }); return; }
    res.json({ userId: session.userId, expiresAt: session.expiresAt });
  });

  app.get('/api/agents', async (_req: Request, res: Response) => {
    try {
      const docs = await loadActiveAgents();
      const agents = docs.map((a) => ({
        agentId:     a.agentId,
        displayName: a.displayName,
        locale:      a.locale,
        zoneId:      a.zoneId,
        modelId:     a.modelId,
        brainConfig: toPublicBrain(a.brainConfig, a.modelId),
        profile:     a.profile,
        status:      a.status,
        lastSeenAt:  a.lastSeenAt,
      }));
      res.json({ agents });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch agents');
      res.status(500).json({ error: 'Failed to load agents' });
    }
  });

  app.get('/api/zones', (_req: Request, res: Response) => {
    res.json({ zones: EXAMPLE_ZONES });
  });

  app.get('/api/brains', (_req: Request, res: Response) => {
    res.json(
      Object.values(BrainProvider).map((provider) => ({
        provider,
        label:      BRAIN_PROVIDER_LABELS[provider],
        models:     BRAIN_MODELS[provider],
        configured: isProviderConfigured({ provider }),
      })),
    );
  });

  /** Admin endpoint: updates the global default brain of an agent across all instances */
  app.post('/api/agents/:agentId/brain', requireAdminKey, async (req: Request, res: Response) => {
    if (!isMongoReady()) {
      res.status(503).json({ error: 'MongoDB not connected' });
      return;
    }

    try {
      const agentId = SafeIdSchema.parse(req.params['agentId']);
      const body = RestBrainSwapSchema.parse(req.body);

      const agentDoc = await AgentModel.findByAgentId(agentId).lean();
      if (!agentDoc) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const previousBrain = toPublicBrain(agentDoc.brainConfig, agentDoc.modelId);
      const nextBrain: PublicBrainConfig = {
        provider:    body.provider,
        model:       body.model,
        maxTokens:   body.maxTokens ?? agentDoc.brainConfig?.maxTokens ?? 2048,
        temperature: body.temperature ?? agentDoc.brainConfig?.temperature ?? 0.7,
      };

      await AgentModel.updateOne(
        { agentId },
        {
          $set: {
            'brainConfig.provider':    nextBrain.provider,
            'brainConfig.model':       nextBrain.model,
            'brainConfig.maxTokens':   nextBrain.maxTokens,
            'brainConfig.temperature': nextBrain.temperature,
            modelId:                   nextBrain.model,
          },
        },
      );

      // Invalidate local & remote API instances via Redis Pub/Sub
      invalidateLocalAgentCache(agentId);
      await pubClient.publish(BRAIN_EVICT_CHANNEL, agentId);

      const broadcast: BrainSwapBroadcast = {
        agentId,
        previousBrain,
        newBrain:  nextBrain,
        swappedBy: body.requestedBy ?? 'admin',
        swappedAt: new Date().toISOString(),
        scope:     'global',
      };

      io.emit('agent:brain-updated', broadcast);
      res.json(broadcast);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'Validation failed', details: z.flattenError(err).fieldErrors });
        return;
      }
      logger.error({ err }, 'Failed to swap global agent brain');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/rooms/:roomId/workspace/:zoneId', requireRoomAccess, async (req: Request, res: Response) => {
    try {
      const roomId = RoomIdSchema.parse(req.params['roomId']);
      const zoneId = SafeIdSchema.refine((id) => VALID_ZONE_IDS.has(id), 'Unknown zoneId').parse(
        req.params['zoneId'],
      );
      const state = await workspaceMgr.getZoneWorkspace(zoneId, roomId);
      res.json(state);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'Invalid roomId or zoneId' });
        return;
      }
      logger.error({ err }, 'Failed to read zone workspace');
      res.status(500).json({ error: 'Failed to read workspace' });
    }
  });

  app.post('/api/rooms/:roomId/workspace', requireRoomAccess, async (req: Request, res: Response) => {
    try {
      const roomId = RoomIdSchema.parse(req.params['roomId']);
      const body = WorkspaceWriteSchema.parse(req.body);
      const entry = await workspaceMgr.write({ ...body, roomId });
      res.status(201).json(entry);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'Validation failed', details: z.flattenError(err).fieldErrors });
        return;
      }
      logger.error({ err }, 'Failed to write workspace entry');
      res.status(500).json({ error: 'Failed to create workspace entry' });
    }
  });

  /* Express error handler (handles CORS rejections & malformed JSON cleanly) */
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.message === 'CORS_ORIGIN_DENIED') {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if ('type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON payload' });
      return;
    }
    logger.error({ err: err.message }, 'Unhandled HTTP error');
    res.status(500).json({ error: 'Internal server error' });
  });

  /* ─── SOCKET.IO EVENTS ─────────────────────────────────── */
  io.on('connection', (socket) => {
    connectionCount++;
    const userId = socket.data['userId'] as string;
    const privateRoomId = `wora-${userId}`;
    const skillRoom = skillChannel(privateRoomId);
    const expiresAt = Number(socket.data['sessionExpiresAt'] ?? 0);
    const hasActiveSession = () => expiresAt > Date.now();
    let sessionExpiry: NodeJS.Timeout | undefined;
    function expireSession() {
      if (!socket.connected) return;
      socket.emit('session:expired');
      socket.disconnect(true);
    }
    function enforceSessionDeadline() {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) { expireSession(); return; }
      sessionExpiry = setTimeout(enforceSessionDeadline, Math.min(remaining, 2_147_483_647));
      sessionExpiry.unref();
    }
    if (expiresAt) enforceSessionDeadline();
    socket.once('disconnect', () => clearTimeout(sessionExpiry));
    socket.use((_packet, next) => {
      if (expiresAt && !hasActiveSession()) { expireSession(); return; }
      next();
    });

    socket.on('room:join', async (raw: unknown) => {
      const parsed = RoomJoinSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid room:join payload' });
        return;
      }

      try {
        await socket.join(hasActiveSession() ? [privateRoomId, skillRoom] : privateRoomId);
        socket.data['roomId'] = privateRoomId;

        const pos = parsed.data.position ?? { x: 0, y: 0, z: 2 };
        const nowIso = new Date().toISOString();

        const [, agents, brainOverrides, recentMessages, workspaces, skillIndex] = await Promise.all([
          presence.set(privateRoomId, userId, {
            participantId: userId,
            roomId:        privateRoomId,
            position:      pos,
            joinedAt:      nowIso,
          }),
          loadActiveAgents(),
          getRoomBrainOverrides(pubClient, privateRoomId),
          getRoomMessages(pubClient, privateRoomId, ROOM_HISTORY_LIMIT),
          workspaceMgr.getRoomWorkspaces(
            EXAMPLE_ZONES.map((z) => z.id),
            privateRoomId,
          ),
          hasActiveSession() && isMongoReady() ? skillStore.getIndex(privateRoomId).catch(() => null) : null,
        ]);

        if (IS_PRODUCTION && agents.length === 0) {
          await socket.leave(privateRoomId);
          await socket.leave(skillRoom);
          socket.emit('error', { code: 'ROSTER_UNAVAILABLE', message: 'فريق الخادم غير جاهز بعد. جرّب إعادة الاتصال بعد إعداده.' });
          return;
        }
        const signals = await runtime.snapshot(privateRoomId, agents.map((agent) => agent.agentId)).catch(() => null);
        const participants = agents.map((a) => {
          const signal = signals?.get(a.agentId);
          return { ...mapAgentToParticipant(a, privateRoomId, brainOverrides[a.agentId]),
            ...(skillIndex && hasActiveSession() ? { skillSnapshot: skillIndex[a.agentId] ?? { revision: 0, activeNames: [] } } : {}),
            ...(signal ? { lifecycleRevision: signal.revision, lifecycleState: signal.state, avatarState: lifecycleToAvatarState(signal.state) } : {}) };
        });

        if (!socket.connected || (expiresAt && !hasActiveSession())) return;
        socket.emit('room:state', {
          room: {
            id:               privateRoomId,
            name:             'Your Workspace',
            accessMode:       RoomAccessMode.Private,
            createdAt:        nowIso,
            createdBy:        userId,
            assignedAgentIds: agents.map((a) => a.agentId),
            zoneIds:          EXAMPLE_ZONES.map((z) => z.id),
          },
          participants,
          presence: [{ participantId: userId, roomId: privateRoomId, position: pos, joinedAt: nowIso }],
          recentMessages,
          zones: EXAMPLE_ZONES,
          workspaces,
        });
      } catch (err) {
        logger.error({ err, userId }, 'room:join failed');
        socket.emit('error', { code: 'JOIN_ERROR', message: 'تعذّر فتح مساحة العمل. أعد الاتصال بعد قليل.' });
      }
    });

    socket.on('room:leave', async () => {
      try {
        await socket.leave(privateRoomId);
        await socket.leave(skillRoom);
        // Only clear presence if user has no remaining active sockets in this room
        const remaining = await io.in(privateRoomId).fetchSockets();
        if (remaining.length === 0) {
          await presence.remove(privateRoomId, userId);
        }
      } catch (err) {
        logger.warn({ err, userId }, 'room:leave cleanup warning');
      }
    });

    socket.on('room:move', async (raw: unknown) => {
      const allowed = await rateLimiter.allow('move', userId, 120, 10_000);
      if (!allowed) return;

      const parsed = RoomMoveSchema.safeParse(raw);
      if (!parsed.success) return;

      await presence.update(privateRoomId, userId, parsed.data.position).catch(() => {});
    });

    socket.on('message:send', async (raw: unknown) => {
      if (!socket.rooms.has(privateRoomId)) return;
      const allowed = await rateLimiter.allow('msg', userId, 20, 60_000);
      if (!allowed) {
        socket.emit('error', {
          code:    'RATE_LIMITED',
          message: 'وصلت للحدّ المسموح من الرسائل في الدقيقة. جرّب بعد قليل.',
        });
        return;
      }

      const parsed = MessageSendSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_MESSAGE', message: 'Invalid message payload' });
        return;
      }

      const { content, type, replyToId, targetAgentId } = parsed.data;

      try {
        const agents = await loadActiveAgents();
        const parsedMentions = extractUniqueMentions(content, MAX_MENTIONS_PER_MSG);

        // Resolve unique target agents from @mentions (or explicit targetAgentId fallback)
        const targetMap = new Map<string, CachedAgent>();
        const resolvedMentions: Message['mentions'] = [];

        for (const m of parsedMentions) {
          const matched = matchAgentByMention(agents, m.token);
          if (matched) {
            targetMap.set(matched.agentId, matched);
            resolvedMentions.push({
              participantId: matched.agentId,
              raw:           m.raw,
              startIndex:    m.startIndex,
              endIndex:      m.endIndex,
            });
          }
        }

        if (targetMap.size === 0) {
          const direct = targetAgentId ? agents.find((a) => a.agentId === targetAgentId)
            : parsedMentions.length ? undefined : agents.find((a) => a.agentId === 'agent-planner-01') ?? agents[0];
          if (direct) targetMap.set(direct.agentId, direct);
        }

        // Load prior history BEFORE appending current user message
        const priorMessages =
          targetMap.size > 0
            ? await getRoomMessages(pubClient, privateRoomId, AI_CONTEXT_TURNS)
            : [];

        const userMsg: Message = {
          id:        randomUUID(),
          roomId:    privateRoomId,
          senderId:  userId,
          type,
          content,
          timestamp: new Date().toISOString(),
          mentions:  resolvedMentions,
          replyToId,
        };

        await appendRoomMessage(pubClient, privateRoomId, userMsg);
        io.to(privateRoomId).emit('message:received', { message: userMsg });

        if (targetMap.size === 0) {
          socket.emit('error', { code: 'AGENT_UNAVAILABLE', message: 'اتحفظت الرسالة، لكن مفيش وكيل متاح للرد. اختار وكيل من الفريق.' });
          return;
        }

        const history: ConversationTurn[] = priorMessages
          .filter((m) => m.type === MessageType.Text || m.type === MessageType.Mention)
          .map((m) => ({ senderId: m.senderId, content: m.content }));

        const roomOverrides = await getRoomBrainOverrides(pubClient, privateRoomId);

        for (const agent of targetMap.values()) {
          const override = roomOverrides[agent.agentId];
          const keyCheckTarget = override
            ? { provider: override.provider }
            : (agent.brainConfig ?? { provider: BrainProvider.Google });

          if (!isProviderConfigured(keyCheckTarget)) {
            const label = BRAIN_PROVIDER_LABELS[keyCheckTarget.provider] ?? keyCheckTarget.provider;
            socket.emit('error', {
              code:    'MISSING_API_KEY',
              message: `اتحفظت الرسالة. الردّ من ${agent.displayName} محتاج تفعيل ${label} على الخادم.`,
            });
            continue;
          }

          const signal = AbortSignal.timeout(2_500);
          const metered = await rateLimiter.allow('chat-job-user', userId, 20, 60_000, signal)
            && await rateLimiter.allow('chat-job-global', 'workspace', 360, 3_600_000, signal);
          if (!metered) {
            socket.emit('error', { code: 'RATE_LIMITED', message: 'اتحفظت الرسالة، لكن تم بلوغ حدّ الردود التلقائية. جرّب لاحقًا.' });
            break;
          }
          if (!socket.connected || (expiresAt && !hasActiveSession())) return;
          await aiQueue.enqueue({
            messageId:            randomUUID(),
            agentId:              agent.agentId,
            displayName:          agent.displayName,
            customRole:           agent.profile.customRole ?? 'AI Agent',
            tone:                 agent.profile.tone ?? 'Analytical',
            tagline:              agent.profile.tagline ?? '',
            specialty:            agent.profile.specialty,
            skills:               agent.profile.skills ?? [],
            boundaries:           agent.profile.boundaries ?? [],
            locale:               agent.locale ?? 'en',
            systemPromptOverride: agent.systemPromptOverride,
            brainOverride:        override,
            history,
            userMessage:          content,
            roomId:               privateRoomId,
            senderId:             userId,
          });

        }
      } catch (err) {
        logger.error({ err, userId }, 'message:send processing error');
        socket.emit('error', { code: 'MESSAGE_ERROR', message: 'تعذّر تأكيد معالجة الرسالة. تحقّق من المحادثة قبل إعادة الإرسال.' });
      }
    });

    /**
     * Per-room isolated Hot-Swap Brain:
     * Customizes the agent's model exclusively inside this user's private room
     * so one user can never alter another user's workspace configuration.
     */
    socket.on('agent:brain-swap', async (raw: unknown) => {
      const allowed = await rateLimiter.allow('swap', userId, 15, 60_000);
      if (!allowed) {
        socket.emit('error', { code: 'RATE_LIMITED', message: 'Too many brain swaps. Try again shortly.' });
        return;
      }

      const parsed = SocketBrainSwapSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_BRAIN', message: 'Invalid provider or model selection' });
        return;
      }

      try {
        const { agentId, newBrain } = parsed.data;
        const agents = await loadActiveAgents();
        const agent = agents.find((a) => a.agentId === agentId);
        if (!agent) {
          socket.emit('error', { code: 'AGENT_NOT_FOUND', message: 'Agent not found' });
          return;
        }

        const existingOverrides = await getRoomBrainOverrides(pubClient, privateRoomId);
        const previousBrain =
          existingOverrides[agentId] ?? toPublicBrain(agent.brainConfig, agent.modelId);

        await setRoomBrainOverride(pubClient, privateRoomId, agentId, newBrain);

        const broadcast: BrainSwapBroadcast = {
          agentId,
          previousBrain,
          newBrain,
          swappedBy: userId,
          swappedAt: new Date().toISOString(),
          scope:     'room',
        };
        io.to(privateRoomId).emit('agent:brain-updated', broadcast);
      } catch (err) {
        logger.error({ err, userId }, 'agent:brain-swap failed');
        socket.emit('error', { code: 'SWAP_ERROR', message: 'Failed to swap agent brain' });
      }
    });

    function hasLiveSession() {
      const token = socket.handshake.auth?.['token'];
      return Boolean(AUTH_SECRET && typeof token === 'string' && verifySessionToken(token.trim(), AUTH_SECRET, true)?.userId === userId);
    }

    // Only authenticated, metered users with a configured agent may start a text reply.
    // Failure to prepare the reply must not prevent saving the assigned task.
    async function directorExecutionBrain(agent: CachedAgent) {
      if (!hasLiveSession()) return null;
      const signal = AbortSignal.timeout(2_000);
      try {
        const command = pubClient.withCommandOptions({ abortSignal: signal, timeout: 1_500 });
        const json = pubClient.isReady ? await command.hGet(roomBrainsKey(privateRoomId), agent.agentId) : null;
        const override = json ? PublicBrainSchema.safeParse(JSON.parse(json)) : null;
        const brain = override?.success ? override.data : toPublicBrain(agent.brainConfig, agent.modelId);
        if (!isSupportedModel(brain.provider, brain.model) || !isProviderConfigured(brain)) return null;
        if (!await rateLimiter.allow('director-run-user', userId, 6, 60_000, signal)
          || !await rateLimiter.allow('director-run-global', 'workspace', 90, 3_600_000, signal)) return null;
        return brain;
      } catch { return null; }
    }

    socket.on('director:recommend', async (raw: unknown, ack: (result: DirectorRecommendation) => void) => {
      if (typeof ack !== 'function') return;
      if (!recommendDirector || !hasLiveSession() || !socket.rooms.has(privateRoomId)) { ack({ ok: false }); return; }
      const disconnected = new AbortController();
      const abort = () => disconnected.abort();
      socket.once('disconnect', abort);
      try { ack(await recommendDirector(userId, raw, disconnected.signal)); }
      finally { socket.off('disconnect', abort); }
    });

    socket.on('workspace:signal', async (raw: unknown, ack?: ReplyToAssignment) => {
      function reply(result: AssignmentAck) {
        if (typeof ack === 'function') ack(result);
        else if (!result.ok) socket.emit('error', { code: result.code, message: 'تعذّر حفظ المهمة.' });
      }
      const parsed = workspaceSignalSchema.safeParse(raw);
      if (!parsed.success || !socket.rooms.has(privateRoomId)) { reply({ ok: false, code: 'INVALID_SIGNAL' }); return; }
      try {
        if (!await rateLimiter.allow('ws-signal', userId, 30, 60_000)) { reply({ ok: false, code: 'RATE_LIMITED' }); return; }
        const { zoneId, agentId, title, data } = parsed.data;
        const agent = (await loadActiveAgents()).find((item) => item.agentId === agentId);
        const fromDirector = data.source === 'director';
        if (!agent || (fromDirector && agent.zoneId !== zoneId)) { reply({ ok: false, code: 'AGENT_UNAVAILABLE' }); return; }
        const brain = fromDirector ? await directorExecutionBrain(agent) : null;
        if (!socket.rooms.has(privateRoomId)) return;
        const entry = await workspaceMgr.write({ zoneId, roomId: privateRoomId, type: 'task', authorAgentId: userId, targetAgentId: agentId, title,
          payload: fromDirector ? { ...data, directorExecution: brain ? 'pending' : 'unavailable' } : data });
        reply({ ok: true, entry });
        if (brain && data.brief) {
          // The target comes only from the validated assignment, never from @mentions in the brief.
          void aiQueue.enqueue({
            messageId: entry.id, workspaceTask: { zoneId, entryId: entry.id }, roomId: privateRoomId, senderId: userId,
            agentId: agent.agentId, displayName: agent.displayName, locale: agent.locale ?? 'en',
            customRole: agent.profile.customRole ?? 'AI Agent', tone: agent.profile.tone ?? 'Analytical',
            tagline: agent.profile.tagline ?? '', specialty: agent.profile.specialty, skills: agent.profile.skills ?? [],
            boundaries: agent.profile.boundaries ?? [], brainOverride: brain, history: [], userMessage: data.brief,
          }).catch(async () => {
            try { await workspaceMgr.updateStatus(zoneId, privateRoomId, entry.id, 'open', { directorExecution: 'failed' }); }
            catch { logger.warn({ entryId: entry.id }, 'Could not record director queue failure'); }
          });
        }
      } catch {
        logger.error({ userId }, 'workspace:signal write failed');
        reply({ ok: false, code: 'WORKSPACE_UNCONFIRMED' });
      }
    });

    socket.on('disconnect', async () => {
      connectionCount = Math.max(0, connectionCount - 1);
      try {
        const remaining = await io.in(privateRoomId).fetchSockets();
        if (remaining.length === 0) {
          await presence.remove(privateRoomId, userId);
        }
      } catch {
        // Ignore cleanup errors during shutdown
      }
    });
  });

  /* ─── START & GRACEFUL SHUTDOWN ────────────────────────── */
  await new Promise<void>((resolve) => {
    httpServer.listen(port, IS_PRODUCTION ? '0.0.0.0' : '127.0.0.1', () => {
      logger.info({ port, maxSockets: MAX_SOCKETS, env: NODE_ENV }, 'Wora Agent OS v4.1 listening');
      resolve();
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 15_000);
    forceTimer.unref();

    try {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await aiQueue.close();
      await workspaceMgr.disconnect();
      await Promise.allSettled([eventSub.quit(), subClient.quit(), pubClient.quit()]);
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT',  () => void shutdown('SIGINT'));

  return { io, app, httpServer, shutdown };
}
