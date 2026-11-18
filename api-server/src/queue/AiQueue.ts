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
  lifecycleToAvatarState,
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
  workspaceTask?:        { zoneId: string; entryId: string };
}

type WorkspaceProgress = { state: 'started' } | { state: 'response'; text: string } | { state: 'failed' };

export interface AiQueueOptions {
  concurrency?:       number;
  requestTimeoutMs?:  number;
  onWorkspaceProgress?: (job: AiJobData, progress: WorkspaceProgress) => Promise<boolean>;
  onReplyPersisted?:  (roomId: string, message: Message, agentId: string) => Promise<void>;
  onLifecycle?:       (job: AiJobData, state: AgentLifecycleState, jobTtlMs: number) => void;
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
  private readonly onWorkspaceProgress?: AiQueueOptions['onWorkspaceProgress'];
  private readonly onReplyPersisted?: AiQueueOptions['onReplyPersisted'];
  private readonly onLifecycle?: AiQueueOptions['onLifecycle'];

  constructor(
    private readonly io: SocketIOServer,
    redisUrl: string,
    options: AiQueueOptions = {},
  ) {
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.requestTimeoutMs = Math.max(5_000, options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.onReplyPersisted = options.onReplyPersisted;
    this.onWorkspaceProgress = options.onWorkspaceProgress;
    this.onLifecycle = options.onLifecycle;

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
      if (job.data.workspaceTask) {
        logger.warn({ agentId, entryId: job.data.workspaceTask.entryId }, 'Director task response failed');
        if (isFinalFailure) {
          void this.onWorkspaceProgress?.(job.data, { state: 'failed' }).catch(() => {
            logger.warn({ entryId: job.data.workspaceTask?.entryId }, 'Could not record failed director task response');
          });
          this.reportLifecycle(job.data, AgentLifecycleState.Error);
        }
        return;
      }

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
        this.reportLifecycle(job.data, AgentLifecycleState.Refining);
        return;
      }

      this.reportLifecycle(job.data, AgentLifecycleState.Error);

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
      this.reportLifecycle(job.data, AgentLifecycleState.Idle);
    });

    logger.info({ queue: QUEUE_NAME, concurrency }, 'AiQueue worker initialized');
  }

  private reportLifecycle(job: AiJobData, state: AgentLifecycleState) {
    const duration = job.workspaceTask ? Math.min(this.requestTimeoutMs, 45_000) : this.requestTimeoutMs;
    if (this.onLifecycle) this.onLifecycle(job, state, Math.min(duration + 30_000, 900_000));
    else this.io.to(job.roomId).emit('agent:lifecycle', { roomId: job.roomId, agentId: job.agentId, state, avatarState: lifecycleToAvatarState(state) });
  }

  async enqueue(data: AiJobData, priority = 10): Promise<void> {
    await this.queue.add('ai-complete', data, { priority, ...(data.workspaceTask ? { attempts: 1, jobId: data.workspaceTask.entryId } : {}) });
  }

  private async process(job: Job<AiJobData>): Promise<void> {
    const { agentId, roomId, messageId, userMessage, history, brainOverride, workspaceTask } = job.data;

    // A director job is a single text reply attached to a saved task in this room,
    // not a regular chat message and never a tool or integration action.
    if (workspaceTask && !await this.onWorkspaceProgress?.(job.data, { state: 'started' })) return;
    const systemPrompt = buildSystemPrompt(job.data) + (workspaceTask
      ? '\nRespond to the assigned task with a useful text deliverable or state what information is missing. No external tools are available. Do not claim to have acted on files, accounts, services, or outside systems.'
      : '');
    this.reportLifecycle(job.data, AgentLifecycleState.Thinking);
    let responding = false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), workspaceTask ? Math.min(this.requestTimeoutMs, 45_000) : this.requestTimeoutMs);

    try {
      const result = await BrainAdapterFactory.complete(agentId, {
        systemPrompt,
        history,
        userMessage,
        brainOverride,
        taskContext:   { agentId, roomId },
        signal:        controller.signal,
        maxTokens: workspaceTask ? Math.min(2_300, brainOverride?.maxTokens ?? 2_300) : undefined,
        onChunk: workspaceTask ? undefined : (chunk: string, isDone: boolean) => {
          if (chunk && !responding) {
            responding = true;
            this.reportLifecycle(job.data, AgentLifecycleState.Responding);
          }
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

      if (workspaceTask) {
        const text = result.text.trim();
        if (!text) throw new Error('Empty director task response');
        await this.onWorkspaceProgress?.(job.data, { state: 'response', text: text.slice(0, 12_000) });
        return;
      }

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
