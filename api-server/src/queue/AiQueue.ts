/**
 * AiQueue.ts — Wora Agent OS (Zero-Secret BullMQ Worker)
 * ──────────────────────────────────────────────────────────────────
 * Security & reliability guarantees:
 *  - NEVER stores API keys in job payloads (resolved in-process by BrainAdapterFactory).
 *  - Passes bounded conversation history & per-room brain overrides cleanly.
 *  - Enforces per-request timeout via AbortController so hung streams never stall workers.
 *  - Aborts dangling partial streams on failure and only posts a user-facing error
 *    message once all retry attempts are exhausted.
 *  - Persists completed assistant replies via `onReplyPersisted` hook.
 */

import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import type { Server as SocketIOServer } from 'socket.io';
import { BrainAdapterFactory, type ConversationTurn } from '../ai/BrainAdapter.js';
import { logger } from '../lib/logger.js';
import {
  AgentLifecycleState,
  AvatarAnimState,
  MessageType,
} from '../../../shared/types/index.js';
import type {
  Message,
  MessageStreamPayload,
  PublicBrainConfig,
  SupportedLocale,
} from '../../../shared/types/index.js';

export interface AiJobData {
  messageId:             string;
  agentId:               string;
  displayName:           string;
  customRole:            string;
  tone:                  string;
  tagline:               string;
  specialty?:            string;
  skills:                string[];
  boundaries:            string[];
  locale:                SupportedLocale;
  systemPromptOverride?: string;
  brainOverride?:        PublicBrainConfig;
  history:               ConversationTurn[];
  userMessage:           string;
  roomId:                string;
  senderId:              string;
}

export interface AiQueueOptions {
  concurrency?:       number;
  requestTimeoutMs?:  number;
  onReplyPersisted?:  (roomId: string, message: Message, agentId: string) => Promise<void>;
}

const QUEUE_NAME         = 'wora-ai-jobs';
const DEFAULT_CONCURRENCY = Number(process.env['AI_CONCURRENCY'] ?? 50);
const DEFAULT_TIMEOUT_MS  = Number(process.env['AI_REQUEST_TIMEOUT_MS'] ?? 90_000);

function buildSystemPrompt(job: AiJobData): string {
  if (job.systemPromptOverride?.trim()) {
    return job.systemPromptOverride.trim();
  }

  const lines: string[] = [
    `You are ${job.displayName}, ${job.customRole} inside the Wora Agent OS collaborative workspace.`,
  ];
  if (job.tagline) lines.push(job.tagline);
  if (job.specialty) lines.push(`Core specialty: ${job.specialty}.`);
  if (job.skills.length > 0) lines.push(`Key skills: ${job.skills.join(', ')}.`);
  if (job.boundaries.length > 0) {
    lines.push(`Operating boundaries: ${job.boundaries.join('; ')}.`);
  }
  lines.push(
    `Communication tone: ${job.tone || 'Analytical'}.`,
    'Reply in the same language the user writes in (including Arabic or English).',
    'Be clear, actionable, concise, and technically rigorous.',
  );
  return lines.join('\n');
}

export class AiQueue {
  private readonly queue:            Queue<AiJobData>;
  private readonly worker:           Worker<AiJobData>;
  private readonly requestTimeoutMs: number;
  private readonly onReplyPersisted?: AiQueueOptions['onReplyPersisted'];

  constructor(
    private readonly io: SocketIOServer,
    redisUrl: string,
    options: AiQueueOptions = {},
  ) {
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.requestTimeoutMs = Math.max(5_000, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.onReplyPersisted = options.onReplyPersisted;

    const connection = {
      url:                  redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck:     false,
    };

    this.queue = new Queue<AiJobData>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts:         2,
        removeOnComplete: { count: 200, age: 3_600 },
        removeOnFail:     { count: 100, age: 86_400 },
        backoff:          { type: 'exponential', delay: 2_000 },
      },
    });

    this.queue.on('error', (err) => {
      logger.error({ err: err.message }, 'AiQueue error');
    });

    this.worker = new Worker<AiJobData>(
      QUEUE_NAME,
      async (job: Job<AiJobData>) => this.process(job),
      {
        connection,
        concurrency,
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    this.worker.on('error', (err) => {
      logger.error({ err: err.message }, 'AiQueue worker error');
    });

    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const { agentId, displayName, roomId, messageId } = job.data;
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalFailure = job.attemptsMade >= maxAttempts;

      logger.error(
        { agentId, roomId, attempt: job.attemptsMade, maxAttempts, err: err.message },
        'AI job attempt failed',
      );

      // Always terminate any partial in-flight stream bubble in the client UI
      const abortPayload: MessageStreamPayload = {
        messageId,
        agentId,
        taskId:       messageId,
        chunk:        '',
        isDone:       true,
        isRefinement: false,
        aborted:      true,
        roomId,
      };
      this.io.to(roomId).emit('message:stream', abortPayload);

      if (!isFinalFailure) {
        this.io.to(roomId).emit('agent:lifecycle', {
          agentId,
          state:       AgentLifecycleState.Refining,
          avatarState: AvatarAnimState.Thinking,
        });
        return;
      }

      this.io.to(roomId).emit('agent:lifecycle', {
        agentId,
        state:       AgentLifecycleState.Error,
        avatarState: AvatarAnimState.Error,
      });

      this.io.to(roomId).emit('message:received', {
        message: {
          id:        randomUUID(),
          roomId,
          senderId:  agentId,
          type:      MessageType.System,
          content:   `${displayName} encountered a provider error and could not finish responding. Please try again.`,
          timestamp: new Date().toISOString(),
          mentions:  [],
        } satisfies Message,
      });
    });

    this.worker.on('completed', (job) => {
      const { agentId, roomId } = job.data;
      this.io.to(roomId).emit('agent:lifecycle', {
        agentId,
        state:       AgentLifecycleState.Idle,
        avatarState: AvatarAnimState.Idle,
      });
    });

    logger.info({ queue: QUEUE_NAME, concurrency }, 'AiQueue worker initialized');
  }

  async enqueue(data: AiJobData, priority = 10): Promise<void> {
    await this.queue.add('ai-complete', data, { priority });
  }

  private async process(job: Job<AiJobData>): Promise<void> {
    const { agentId, roomId, messageId, userMessage, history, brainOverride } = job.data;

    // On retries, suffix with attempt number if needed — abort handler already cleared prior stream
    this.io.to(roomId).emit('agent:lifecycle', {
      agentId,
      state:       AgentLifecycleState.Responding,
      avatarState: AvatarAnimState.Talking,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const result = await BrainAdapterFactory.complete(agentId, {
        systemPrompt:  buildSystemPrompt(job.data),
        history,
        userMessage,
        brainOverride,
        taskContext:   { agentId, roomId },
        signal:        controller.signal,
        onChunk: (chunk: string, isDone: boolean) => {
          const payload: MessageStreamPayload = {
            messageId,
            agentId,
            taskId:       messageId,
            chunk,
            isDone,
            isRefinement: false,
            roomId,
          };
          this.io.to(roomId).emit('message:stream', payload);
        },
      });

      if (this.onReplyPersisted && result.text.trim()) {
        const replyMsg: Message = {
          id:        messageId,
          roomId,
          senderId:  agentId,
          type:      MessageType.Text,
          content:   result.text,
          timestamp: new Date().toISOString(),
          mentions:  [],
        };
        await this.onReplyPersisted(roomId, replyMsg, agentId).catch((err: Error) => {
          logger.warn({ err: err.message, roomId, agentId }, 'Failed to persist AI reply');
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async getStats(): Promise<{ waiting: number; active: number; completed: number; failed: number }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
