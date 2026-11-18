/**
 * preview-server.ts — Wora Agent OS v4.1 (Zero-Dependency Sandbox Preview)
 * ────────────────────────────────────────────────────────────────────────
 * Standalone in-memory API + Socket.IO server for instant command interface evaluation
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
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { z } from 'zod';

import { SEED_AGENTS } from './seed.js';
import { EXAMPLE_ZONES } from '../zones.js';
import { workspaceSignalSchema, type ReplyToAssignment } from '../core/taskSignal.js';
import { createStudioRouter } from '../studio/router.js';
import { verifySessionToken } from '../lib/session.js';
import { createGitHubImporter } from '../skills/github.js';
import { createSkillsRouter } from '../skills/router.js';
import { createMemorySkillStore } from '../skills/store.js';
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
  lifecycleToAvatarState,
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
    provider:    z.enum(BrainProvider),
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

/* ─── ISOLATED IN-MEMORY ROOM STATE ─────────────────────── */
interface RoomBucket {
  messages:       Message[];
  brainOverrides: Record<string, PublicBrainConfig>;
  workspaces:     Record<string, SharedWorkspaceEntry[]>;
  position:       { x: number; y: number; z: number };
  lifecycle:      Record<string, AgentLifecycleState>;
}

const rooms = new Map<string, RoomBucket>();

function getOrCreateRoom(roomId: string): RoomBucket {
  let bucket = rooms.get(roomId);
  if (!bucket) {
    const welcomeMsg: Message = {
      id:        randomUUID(),
      roomId,
      senderId:  'agent-planner-01',
      type:      MessageType.Text,
      content:
        'أهلاً بك في مساحة عمل Wora التجريبية! اختر وكيلاً لمراسلته، أو اكتب @ متبوعة باسمه. جرّب أن تطلب من الفريق مساعدتك في تخطيط مشروعك القادم.',
      timestamp: new Date().toISOString(),
      mentions:  [],
    };
    bucket = {
      messages:       [welcomeMsg],
      brainOverrides: {},
      workspaces:     {},
      lifecycle:      {},
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
// Keep this public sandbox on local templates even if chat providers are configured.
app.use('/api/studio', createStudioRouter());

const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors:              { origin: true, credentials: true },
  transports:        ['websocket', 'polling'],
  maxHttpBufferSize: 32_768,
  path:              '/socket.io',
});

// Preview users can try the real importer without receiving server credentials or trusting a client-chosen room ID.
const previewSecret = randomBytes(32).toString('hex');
const skillStore = createMemorySkillStore();
const quotas = new Map<string, { end: number; count: number }>();
function allow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  for (const [item, bucket] of quotas) if (bucket.end <= now) quotas.delete(item);
  const current = quotas.get(key);
  if (current) return ++current.count <= limit;
  if (quotas.size >= 512) return false;
  quotas.set(key, { end: now + windowMs, count: 1 });
  return true;
}
function previewTokenFor(userId: string) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1_000) + 86_400 })).toString('base64url');
  return `${payload}.${createHmac('sha256', previewSecret).update(payload).digest('base64url')}`;
}
const githubToken = process.env['GITHUB_SKILLS_TOKEN']?.trim();
app.use('/api/agents/:agentId/skills', createSkillsRouter({
  available: () => true,
  authenticate(token) {
    const session = verifySessionToken(token, previewSecret, true);
    return session ? { userId: session.userId, roomId: `wora-${session.userId}` } : null;
  },
  hasAgent: (_roomId, agentId) => SEED_AGENTS.some((agent) => agent.agentId === agentId),
  async consumeQuota(kind, userId) {
    if (!allow(`${kind}:${userId}`, kind === 'import' ? 4 : 20, 60_000)) return 60;
    if (kind === 'import' && !allow('github', githubToken ? 60 : 16, 3_600_000)) return 3_600;
    return null;
  },
  importGitHub: createGitHubImporter({ token: githubToken }),
  store: skillStore,
  publish: (event) => io.to(event.roomId).emit('agent:skills-updated', event),
}));
app.use(express.json({ limit: '16kb' }));

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
  const token = typeof auth?.['previewSession'] === 'string' ? auth['previewSession'] : '';
  const session = verifySessionToken(token, previewSecret, true);
  const userId = session?.userId ?? `preview-${randomUUID()}`;
  if (connectionCount >= 240 || (rooms.size >= 512 && !rooms.has(`wora-${userId}`))) {
    next(new Error('SERVER_FULL'));
    return;
  }
  getOrCreateRoom(`wora-${userId}`);
  socket.data['userId'] = userId;
  socket.data['previewSession'] = session ? token : previewTokenFor(userId);
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
    const skillIndex = await skillStore.getIndex(privateRoomId);
    socket.emit('room:state', {
      mode: 'preview',
      previewSession: socket.data['previewSession'],
      room: {
        id:               privateRoomId,
        name:             'Your Workspace (Preview)',
        accessMode:       RoomAccessMode.Private,
        createdAt:        nowIso,
        createdBy:        userId,
        assignedAgentIds: SEED_AGENTS.map((a) => a.agentId),
        zoneIds:          EXAMPLE_ZONES.map((z) => z.id),
      },
      participants:   SEED_AGENTS.map((a) => {
        const state = bucket.lifecycle[a.agentId] ?? AgentLifecycleState.Idle;
        return { ...toParticipant(a, privateRoomId, bucket.brainOverrides[a.agentId]), lifecycleState: state, avatarState: lifecycleToAvatarState(state),
          skillSnapshot: skillIndex[a.agentId] ?? { revision: 0, activeNames: [] } };
      }),
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

  socket.on('director:recommend', (_raw: unknown, ack: (result: { ok: false }) => void) => {
    if (typeof ack === 'function') ack({ ok: false });
  });

  socket.on('workspace:signal', (raw: unknown, ack?: ReplyToAssignment) => {
    const parsed = workspaceSignalSchema.safeParse(raw);
    if (!parsed.success || !socket.rooms.has(privateRoomId)) {
      if (typeof ack === 'function') ack({ ok: false, code: 'INVALID_SIGNAL' });
      return;
    }
    const { zoneId, agentId, title, data } = parsed.data;
    if (!SEED_AGENTS.some((agent) => agent.agentId === agentId && (data.source !== 'director' || agent.zoneId === zoneId))) {
      if (typeof ack === 'function') ack({ ok: false, code: 'AGENT_UNAVAILABLE' });
      return;
    }
    const bucket = getOrCreateRoom(privateRoomId);
    const now = new Date().toISOString();
    const entry: SharedWorkspaceEntry = {
      id: randomUUID(), zoneId, roomId: privateRoomId, type: 'task', status: 'open', authorAgentId: userId,
      targetAgentId: agentId, title, payload: { ...data, preview: true, ...(data.source === 'director' ? { directorExecution: 'unavailable' } : {}) },
      createdAt: now, updatedAt: now, chainIds: [],
    };
    bucket.workspaces[zoneId] = [...(bucket.workspaces[zoneId] ?? []).slice(-49), entry];
    io.to(privateRoomId).emit('workspace:update', { zoneId, roomId: privateRoomId, entry, action: 'created' });
    if (typeof ack === 'function') ack({ ok: true, entry });
  });

  function setLifecycle(bucket: RoomBucket, agentId: string, state: AgentLifecycleState) {
    bucket.lifecycle[agentId] = state;
    io.to(privateRoomId).emit('agent:lifecycle', { roomId: privateRoomId, agentId, state, avatarState: lifecycleToAvatarState(state) });
  }

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

      setLifecycle(bucket, agent.agentId, AgentLifecycleState.Thinking);

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
                setLifecycle(bucket, agent.agentId, AgentLifecycleState.Responding);
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
          setLifecycle(bucket, agent.agentId, AgentLifecycleState.Responding);
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
        setLifecycle(bucket, agent.agentId, AgentLifecycleState.Idle);
      } catch {
        setLifecycle(bucket, agent.agentId, AgentLifecycleState.Error);
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
          message: `تعذّر على ${agent.displayName} الردّ. جرّب مرة أخرى.`,
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
