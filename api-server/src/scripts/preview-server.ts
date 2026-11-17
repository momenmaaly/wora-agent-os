/**
 * preview-server.ts — Wora Agent OS v4.1 (Zero-Dependency Sandbox Preview)
 * ────────────────────────────────────────────────────────────────────────
 * Standalone in-memory API + Socket.IO server for instant UI/3D evaluation
 * when Redis and MongoDB are not running (e.g. cloud sandboxes or local demo).
 *
 * Features:
 *  - Pre-loads all 4 core agents (@Aria, @Atlas, @Sentinel, @Nova) & 4 zones
 *  - Enforces strict per-user `wora-{userId}` room isolation & Zod validation
 *  - Supports live per-room Hot-Swap Brain & Shared Workspace HUD entries
 *  - Streams live LLM tokens via `BrainAdapterFactory` when provider API keys
 *    are configured in `process.env`, or falls back to realistic token-by-token
 *    agent simulation so every interactive workflow can be tested immediately.
 *
 * NOTE: For production deployments use `npm start` (`wora-server.ts`) backed by
 *       Redis (`noeviction`) and MongoDB.
 */

import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { z } from 'zod';

import { SEED_AGENTS } from './seed.js';
import { EXAMPLE_ZONES, VALID_ZONE_IDS } from '../zones.js';
import {
  BrainAdapterFactory,
  isProviderConfigured,
  isSupportedModel,
  type ConversationTurn,
} from '../ai/BrainAdapter.js';
import {
  AgentLifecycleState,
  AgentOrigin,
  AvatarAnimState,
  BrainProvider,
  BRAIN_MODELS,
  BRAIN_PROVIDER_LABELS,
  MessageType,
  ParticipantStatus,
  RoomAccessMode,
} from '../../../shared/types/index.js';
import type {
  AgentParticipant,
  BrainSwapBroadcast,
  Message,
  PublicBrainConfig,
  SharedWorkspaceEntry,
  SharedWorkspaceState,
} from '../../../shared/types/index.js';

const PORT = Number(process.env['PORT'] ?? 4000);
const HOST = process.env['PREVIEW_HOST']?.trim() || '127.0.0.1';

/* ─── ZOD SCHEMAS ───────────────────────────────────────── */
const SafeIdSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);

const PositionSchema = z.object({
  x: z.number().finite().min(-500).max(500),
  y: z.number().finite().min(-100).max(100),
  z: z.number().finite().min(-500).max(500),
});

const PublicBrainSchema = z
  .object({
    provider:    z.nativeEnum(BrainProvider),
    model:       z.string().trim().min(1).max(100),
    maxTokens:   z.number().int().min(64).max(16_384).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict()
  .refine((cfg) => isSupportedModel(cfg.provider, cfg.model), {
    message: 'Unsupported model for selected provider',
  });

const MessageSendSchema = z.object({
  roomId:        z.string().max(100).optional(),
  content:       z.string().trim().min(1).max(4_000),
  type:          z.enum([MessageType.Text, MessageType.Mention]).default(MessageType.Text),
  replyToId:     z.string().uuid().optional(),
  targetAgentId: SafeIdSchema.optional(),
});

const SocketBrainSwapSchema = z.object({
  agentId:     SafeIdSchema,
  newBrain:    PublicBrainSchema,
  requestedBy: z.string().trim().max(80).optional(),
  reason:      z.string().trim().max(500).optional(),
});

const WorkspaceSignalSchema = z.object({
  zoneId:  SafeIdSchema.refine((id) => VALID_ZONE_IDS.has(id), 'Unknown zoneId'),
  agentId: SafeIdSchema,
  title:   z.string().trim().min(1).max(200),
  data:    z.record(z.string().max(64), z.unknown()).default({}),
});

/* ─── ISOLATED IN-MEMORY ROOM STATE ─────────────────────── */
interface RoomBucket {
  messages:       Message[];
  brainOverrides: Record<string, PublicBrainConfig>;
  workspaces:     Record<string, SharedWorkspaceEntry[]>;
  position:       { x: number; y: number; z: number };
}

const rooms = new Map<string, RoomBucket>();

function createInitialWorkspaces(roomId: string): Record<string, SharedWorkspaceEntry[]> {
  const now = new Date().toISOString();
  const makeEntry = (
    zoneId: string,
    type: SharedWorkspaceEntry['type'],
    status: SharedWorkspaceEntry['status'],
    authorAgentId: string,
    title: string,
    payload: Record<string, unknown>,
  ): SharedWorkspaceEntry => ({
    id:            randomUUID(),
    zoneId,
    roomId,
    type,
    status,
    authorAgentId,
    title,
    payload,
    createdAt:     now,
    updatedAt:     now,
    chainIds:      [],
  });

  return {
    'zone-planning': [
      makeEntry('zone-planning', 'task', 'approved', 'agent-planner-01', 'Wora v4.1 Production Architecture', {
        milestone: '2026 Production Upgrade',
        isolation: 'wora:ws:zone:{roomId}:{zoneId}',
        sdk:       '@google/genai (Gemini 2.5)',
      }),
      makeEntry('zone-planning', 'handoff', 'in_progress', 'agent-planner-01', 'Multi-Agent Sprint Coordination', {
        assignee: 'agent-coder-01',
        priority: 'high',
      }),
    ],
    'zone-engineering': [
      makeEntry('zone-engineering', 'artifact', 'approved', 'agent-coder-01', 'Singleton Socket Manager + Batched mGet', {
        duplicateStreams: 0,
        redisComplexity:  'O(1) MGET',
      }),
    ],
    'zone-review': [
      makeEntry('zone-review', 'review', 'approved', 'agent-reviewer-01', 'Security Audit: Zero Secret Leakage', {
        zodValidation: 'strict',
        corsPolicy:    'allowlist',
        redisPolicy:   'noeviction + requirepass',
      }),
    ],
    'zone-analytics': [
      makeEntry('zone-analytics', 'signal', 'open', 'agent-analyst-01', 'Telemetry Baseline Ready (10k Rooms)', {
        p95StreamStartMs: 180,
        memoryBound:      '768MB noeviction',
      }),
    ],
  };
}

function getOrCreateRoom(roomId: string): RoomBucket {
  let bucket = rooms.get(roomId);
  if (!bucket) {
    const welcomeMsg: Message = {
      id:        randomUUID(),
      roomId,
      senderId:  'agent-planner-01',
      type:      MessageType.Text,
      content:
        'Welcome to Wora Agent OS v4.1 (Live Preview Sandbox). Select any agent in the 3D office or mention @Aria, @Atlas, @Sentinel, or @Nova to collaborate — or click HOT-SWAP BRAIN to switch 2026 models live.',
      timestamp: new Date().toISOString(),
      mentions:  [],
    };
    bucket = {
      messages:       [welcomeMsg],
      brainOverrides: {},
      workspaces:     createInitialWorkspaces(roomId),
      position:       { x: 0, y: 0, z: 2 },
    };
    rooms.set(roomId, bucket);
  }
  return bucket;
}

function toParticipant(
  seed: (typeof SEED_AGENTS)[number],
  roomId: string,
  override?: PublicBrainConfig,
): AgentParticipant {
  const brain: PublicBrainConfig = override ?? {
    provider:    seed.brainConfig.provider,
    model:       seed.brainConfig.model,
    maxTokens:   seed.brainConfig.maxTokens,
    temperature: seed.brainConfig.temperature,
  };
  const now = new Date().toISOString();
  return {
    id:              seed.agentId,
    displayName:     seed.displayName,
    isHuman:         false,
    isAgent:         true,
    origin:          AgentOrigin.Internal,
    profile: {
      customRole:  seed.profile.customRole,
      tone:        seed.profile.tone,
      skills:      [...seed.profile.skills],
      avatarColor: seed.profile.avatarColor,
      tagline:     seed.profile.tagline,
      specialty:   seed.profile.specialty,
      boundaries:  [...seed.profile.boundaries],
      colleagues:  [...seed.profile.colleagues],
    },
    zoneId:          seed.zoneId,
    lifecycleState:  AgentLifecycleState.Idle,
    socketId:        null,
    assignedRoomIds: [],
    modelId:         brain.model,
    activeTasks:     0,
    brainConfig:     brain,
    avatarState:     AvatarAnimState.Idle,
    locale:          seed.locale,
    createdAt:       now,
    lastSeenAt:      now,
    status:          ParticipantStatus.Online,
    activeRoomIds:   [roomId],
  };
}

function buildWorkspaceStates(roomId: string, bucket: RoomBucket): SharedWorkspaceState[] {
  return EXAMPLE_ZONES.map((z) => {
    const entries = bucket.workspaces[z.id] ?? [];
    const last = entries[entries.length - 1];
    return {
      zoneId:        z.id,
      roomId,
      entries,
      lastWriteAt:   last?.updatedAt ?? new Date().toISOString(),
      lastWrittenBy: last?.authorAgentId ?? '',
    };
  });
}

function buildSimulatedReply(
  agent: (typeof SEED_AGENTS)[number],
  brain: PublicBrainConfig,
  userMessage: string,
  roomId: string,
): string {
  const isArabic = /[\u0600-\u06FF]/.test(userMessage);
  const label = BRAIN_PROVIDER_LABELS[brain.provider];
  const snippet = userMessage.replace(/@[\p{L}\p{N}_-]+/gu, '').trim().slice(0, 120) || userMessage.slice(0, 120);

  if (isArabic) {
    return (
      `[${agent.displayName} · ${agent.profile.customRole}]\n` +
      `النموذج النشط في غرفتك المعزولة (${roomId}): ${label} / ${brain.model}\n\n` +
      `استلمت رسالتك: "${snippet}"\n` +
      `• التخصص: ${agent.profile.specialty}\n` +
      `• وضع المعاينة الحية نشط — أضف مفتاح الـ API في ملف .env لتفعيل الاستدعاء الفعلي لنموذج ${brain.model} مباشرة.`
    );
  }

  return (
    `[${agent.displayName} — ${agent.profile.customRole}]\n` +
    `Active brain in isolated room (${roomId}): ${label} / ${brain.model}\n\n` +
    `Received: "${snippet}"\n` +
    `• Focus: ${agent.profile.specialty}\n` +
    `• Sandbox preview simulation active — set the provider API key in .env to stream live completions from ${brain.model}.`
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/* ─── SERVER BOOTSTRAP ──────────────────────────────────── */
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '16kb' }));

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors:              { origin: true, credentials: true },
  transports:        ['websocket', 'polling'],
  maxHttpBufferSize: 32_768,
  path:              '/socket.io',
});

let connectionCount = 0;

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:      'ok',
    mode:        'sandbox-preview',
    version:     'v4.1-scaled',
    connections: connectionCount,
    agents:      SEED_AGENTS.length,
    zones:       EXAMPLE_ZONES.length,
    rooms:       rooms.size,
    timestamp:   new Date().toISOString(),
  });
});

app.get('/api/agents', (_req: Request, res: Response) => {
  res.json({
    agents: SEED_AGENTS.map((a) => ({
      agentId:     a.agentId,
      displayName: a.displayName,
      locale:      a.locale,
      zoneId:      a.zoneId,
      modelId:     a.brainConfig.model,
      brainConfig: a.brainConfig,
      profile:     a.profile,
      status:      'active',
    })),
  });
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

io.use((socket, next) => {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const rawUserId = typeof auth?.['userId'] === 'string' ? auth['userId'].trim() : '';
  socket.data['userId'] = /^[a-zA-Z0-9_-]{4,64}$/.test(rawUserId)
    ? rawUserId
    : `user-${randomUUID().slice(0, 12)}`;
  next();
});

io.on('connection', (socket) => {
  connectionCount += 1;
  const userId = socket.data['userId'] as string;
  const privateRoomId = `wora-${userId}`;

  socket.on('room:join', async (raw: unknown) => {
    await socket.join(privateRoomId);
    const bucket = getOrCreateRoom(privateRoomId);
    const posCheck = z.object({ position: PositionSchema.optional() }).safeParse(raw ?? {});
    if (posCheck.success && posCheck.data.position) {
      bucket.position = posCheck.data.position;
    }

    const nowIso = new Date().toISOString();
    socket.emit('room:state', {
      room: {
        id:               privateRoomId,
        name:             'Your Workspace (Preview)',
        accessMode:       RoomAccessMode.Private,
        createdAt:        nowIso,
        createdBy:        userId,
        assignedAgentIds: SEED_AGENTS.map((a) => a.agentId),
        zoneIds:          EXAMPLE_ZONES.map((z) => z.id),
      },
      participants:   SEED_AGENTS.map((a) => toParticipant(a, privateRoomId, bucket.brainOverrides[a.agentId])),
      presence:       [{ participantId: userId, roomId: privateRoomId, position: bucket.position, joinedAt: nowIso }],
      recentMessages: bucket.messages.slice(-100),
      zones:          EXAMPLE_ZONES,
      workspaces:     buildWorkspaceStates(privateRoomId, bucket),
    });
  });

  socket.on('room:move', (raw: unknown) => {
    const parsed = z.object({ position: PositionSchema }).safeParse(raw);
    if (!parsed.success) return;
    getOrCreateRoom(privateRoomId).position = parsed.data.position;
  });

  socket.on('agent:brain-swap', (raw: unknown) => {
    const parsed = SocketBrainSwapSchema.safeParse(raw);
    if (!parsed.success) {
      socket.emit('error', { code: 'INVALID_BRAIN', message: 'Invalid provider or model selection' });
      return;
    }
    const seed = SEED_AGENTS.find((a) => a.agentId === parsed.data.agentId);
    if (!seed) {
      socket.emit('error', { code: 'AGENT_NOT_FOUND', message: 'Agent not found' });
      return;
    }

    const bucket = getOrCreateRoom(privateRoomId);
    const previousBrain: PublicBrainConfig = bucket.brainOverrides[seed.agentId] ?? {
      provider:    seed.brainConfig.provider,
      model:       seed.brainConfig.model,
      maxTokens:   seed.brainConfig.maxTokens,
      temperature: seed.brainConfig.temperature,
    };
    bucket.brainOverrides[seed.agentId] = parsed.data.newBrain;

    const broadcast: BrainSwapBroadcast = {
      agentId:   seed.agentId,
      previousBrain,
      newBrain:  parsed.data.newBrain,
      swappedBy: userId,
      swappedAt: new Date().toISOString(),
      scope:     'room',
    };
    io.to(privateRoomId).emit('agent:brain-updated', broadcast);
  });

  socket.on('workspace:signal', (raw: unknown) => {
    const parsed = WorkspaceSignalSchema.safeParse(raw);
    if (!parsed.success) return;
    const bucket = getOrCreateRoom(privateRoomId);
    const now = new Date().toISOString();
    const entry: SharedWorkspaceEntry = {
      id:            randomUUID(),
      zoneId:        parsed.data.zoneId,
      roomId:        privateRoomId,
      type:          'signal',
      status:        'open',
      authorAgentId: parsed.data.agentId,
      title:         parsed.data.title,
      payload:       parsed.data.data,
      createdAt:     now,
      updatedAt:     now,
      chainIds:      [],
    };
    const list = bucket.workspaces[parsed.data.zoneId] ?? [];
    bucket.workspaces[parsed.data.zoneId] = [...list.slice(-49), entry];
    io.to(privateRoomId).emit('workspace:update', {
      zoneId: parsed.data.zoneId,
      roomId: privateRoomId,
      entry,
      action: 'created',
    });
  });

  socket.on('message:send', async (raw: unknown) => {
    const parsed = MessageSendSchema.safeParse(raw);
    if (!parsed.success) {
      socket.emit('error', { code: 'INVALID_MESSAGE', message: 'Invalid message payload' });
      return;
    }

    const bucket = getOrCreateRoom(privateRoomId);
    const { content, type, replyToId, targetAgentId } = parsed.data;

    // Match mentioned agents (Unicode-aware)
    const targets = new Map<string, (typeof SEED_AGENTS)[number]>();
    const mentions: Message['mentions'] = [];
    for (const match of content.matchAll(/@([\p{L}\p{N}_-]{2,40})/gu)) {
      const token = match[1]?.toLowerCase();
      if (!token) continue;
      const found = SEED_AGENTS.find(
        (a) =>
          a.agentId.toLowerCase() === token ||
          a.displayName.toLowerCase() === token ||
          (token.length >= 3 && a.displayName.toLowerCase().startsWith(token)),
      );
      if (found && !targets.has(found.agentId)) {
        targets.set(found.agentId, found);
        const start = match.index ?? 0;
        mentions.push({ participantId: found.agentId, raw: match[0], startIndex: start, endIndex: start + match[0].length });
      }
      if (targets.size >= 3) break;
    }

    if (targets.size === 0) {
      const fallback =
        (targetAgentId ? SEED_AGENTS.find((a) => a.agentId === targetAgentId) : undefined) ??
        SEED_AGENTS[0];
      if (fallback) targets.set(fallback.agentId, fallback);
    }

    const priorHistory: ConversationTurn[] = bucket.messages
      .slice(-16)
      .filter((m) => m.type === MessageType.Text || m.type === MessageType.Mention)
      .map((m) => ({ senderId: m.senderId, content: m.content }));

    const userMsg: Message = {
      id:        randomUUID(),
      roomId:    privateRoomId,
      senderId:  userId,
      type,
      content,
      timestamp: new Date().toISOString(),
      mentions,
      replyToId,
    };
    bucket.messages = [...bucket.messages.slice(-99), userMsg];
    io.to(privateRoomId).emit('message:received', { message: userMsg });

    for (const agent of targets.values()) {
      const activeBrain: PublicBrainConfig = bucket.brainOverrides[agent.agentId] ?? {
        provider:    agent.brainConfig.provider,
        model:       agent.brainConfig.model,
        maxTokens:   agent.brainConfig.maxTokens,
        temperature: agent.brainConfig.temperature,
      };
      const messageId = randomUUID();

      io.to(privateRoomId).emit('agent:lifecycle', {
        agentId:     agent.agentId,
        state:       AgentLifecycleState.Thinking,
        avatarState: AvatarAnimState.Thinking,
      });

      let fullReply = '';
      try {
        if (isProviderConfigured({ provider: activeBrain.provider })) {
          let emittedFirst = false;
          const result = await BrainAdapterFactory.complete(agent.agentId, {
            systemPrompt:  `You are ${agent.displayName}, ${agent.profile.customRole} in Wora Agent OS. Specialty: ${agent.profile.specialty}. Tone: ${agent.profile.tone}.`,
            history:       priorHistory,
            userMessage:   content,
            taskContext:   { agentId: agent.agentId, roomId: privateRoomId },
            brainOverride: activeBrain,
            onChunk: (chunk: string, isDone: boolean) => {
              if (!emittedFirst && chunk) {
                emittedFirst = true;
                io.to(privateRoomId).emit('agent:lifecycle', {
                  agentId:     agent.agentId,
                  state:       AgentLifecycleState.Responding,
                  avatarState: AvatarAnimState.Talking,
                });
              }
              io.to(privateRoomId).emit('message:stream', {
                messageId,
                agentId: agent.agentId,
                taskId:  messageId,
                chunk,
                isDone,
              });
            },
          });
          fullReply = result.text;
        } else {
          await sleep(320);
          io.to(privateRoomId).emit('agent:lifecycle', {
            agentId:     agent.agentId,
            state:       AgentLifecycleState.Responding,
            avatarState: AvatarAnimState.Talking,
          });
          fullReply = buildSimulatedReply(agent, activeBrain, content, privateRoomId);
          const tokens = fullReply.match(/\S+\s*|\s+/g) ?? [fullReply];
          for (const token of tokens) {
            io.to(privateRoomId).emit('message:stream', {
              messageId,
              agentId: agent.agentId,
              taskId:  messageId,
              chunk:   token,
              isDone:  false,
            });
            await sleep(22);
          }
          io.to(privateRoomId).emit('message:stream', {
            messageId,
            agentId: agent.agentId,
            taskId:  messageId,
            chunk:   '',
            isDone:  true,
          });
        }

        if (fullReply.trim()) {
          bucket.messages = [
            ...bucket.messages.slice(-99),
            {
              id:        messageId,
              roomId:    privateRoomId,
              senderId:  agent.agentId,
              type:      MessageType.Text,
              content:   fullReply,
              timestamp: new Date().toISOString(),
              mentions:  [],
            },
          ];
        }
      } catch (err) {
        io.to(privateRoomId).emit('message:stream', {
          messageId,
          agentId: agent.agentId,
          taskId:  messageId,
          chunk:   '',
          isDone:  true,
          aborted: true,
        });
        socket.emit('error', {
          code:    'AI_ERROR',
          message: `${agent.displayName} error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      } finally {
        io.to(privateRoomId).emit('agent:lifecycle', {
          agentId:     agent.agentId,
          state:       AgentLifecycleState.Idle,
          avatarState: AvatarAnimState.Idle,
        });
      }
    }
  });

  socket.on('disconnect', () => {
    connectionCount = Math.max(0, connectionCount - 1);
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`[Wora Preview] Sandbox API & Socket.IO listening on http://${HOST}:${PORT}`);
});
