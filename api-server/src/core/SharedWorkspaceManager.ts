/**
 * SharedWorkspaceManager.ts — Wora Agent OS (Multi-Tenant + O(1) Batched Reads)
 * ──────────────────────────────────────────────────────────────────────────────
 * Key fixes over legacy implementation:
 *  1. Strict tenant isolation: all Redis keys & MongoDB queries are scoped by
 *     BOTH `roomId` AND `zoneId` (`wora:workspace:{roomId}:{zoneId}:*`), so
 *     users never observe or overwrite another room's entries.
 *  2. Zero N+1 queries: `getZoneWorkspace()` batches all reads in a single
 *     `mGet()` call and lazily prunes expired IDs from the sorted-set index.
 *  3. Atomic writes & bounded memory: uses `multi()` pipelines with TTL on both
 *     entry keys and sorted-set indexes, removing evicted entry payloads cleanly.
 */

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createClient, type RedisClientType } from 'redis';
import type { Server as SocketIOServer } from 'socket.io';
import { WorkspaceEntryModel } from '../models/WorkspaceEntry.js';
import { logger } from '../lib/logger.js';
import type {
  SharedWorkspaceEntry,
  SharedWorkspaceState,
  SharedWorkspaceEntryStatus,
  SharedWorkspaceEntryType,
  WorkspaceUpdatePayload,
} from '../../../shared/types/index.js';

const REDIS_KEY_PREFIX     = 'wora:workspace';
const DEFAULT_TTL_SECONDS  = 86_400; // 24 hours
const MAX_ZONE_ENTRIES     = 200;

export interface WriteWorkspaceEntryParams {
  zoneId:         string;
  roomId:         string;
  type:           SharedWorkspaceEntryType;
  authorAgentId:  string;
  targetAgentId?: string;
  title:          string;
  payload?:       Record<string, unknown>;
  parentEntryId?: string;
  expiresInMs?:   number;
}

export class SharedWorkspaceManager {
  private readonly redis:      RedisClientType;
  private readonly io:         SocketIOServer;
  private readonly ownsClient: boolean;

  private constructor(io: SocketIOServer, redis: RedisClientType, ownsClient: boolean) {
    this.io         = io;
    this.redis      = redis;
    this.ownsClient = ownsClient;
  }

  /**
   * Creates a SharedWorkspaceManager. Reuses an existing connected Redis client
   * when provided (saving connection pool slots), or connects its own client.
   */
  static async create(
    io: SocketIOServer,
    existingClient?: RedisClientType,
  ): Promise<SharedWorkspaceManager> {
    if (existingClient) {
      logger.info('SharedWorkspaceManager attached to shared Redis client');
      return new SharedWorkspaceManager(io, existingClient, false);
    }

    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    const client = createClient({ url: redisUrl }) as RedisClientType;
    client.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'SharedWorkspace Redis client error');
    });
    await client.connect();
    logger.info('SharedWorkspaceManager connected dedicated Redis client');
    return new SharedWorkspaceManager(io, client, true);
  }

  /* ─── TENANT-ISOLATED KEY HELPERS ───────────────────────── */
  private assertSafeSegment(value: string, label: string): string {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 120 || trimmed.includes(':')) {
      throw new Error(`Invalid ${label} identifier`);
    }
    return trimmed;
  }

  private entryKey(roomId: string, zoneId: string, entryId: string): string {
    const safeRoom = this.assertSafeSegment(roomId, 'roomId');
    const safeZone = this.assertSafeSegment(zoneId, 'zoneId');
    return `${REDIS_KEY_PREFIX}:${safeRoom}:${safeZone}:entry:${entryId}`;
  }

  private indexKey(roomId: string, zoneId: string): string {
    const safeRoom = this.assertSafeSegment(roomId, 'roomId');
    const safeZone = this.assertSafeSegment(zoneId, 'zoneId');
    return `${REDIS_KEY_PREFIX}:${safeRoom}:${safeZone}:index`;
  }

  /* ─── WRITE ─────────────────────────────────────────────── */
  async write(params: WriteWorkspaceEntryParams): Promise<SharedWorkspaceEntry> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const ttlSeconds = params.expiresInMs
      ? Math.max(1, Math.min(DEFAULT_TTL_SECONDS * 7, Math.ceil(params.expiresInMs / 1_000)))
      : DEFAULT_TTL_SECONDS;

    // Preserve parent chain if parent exists in the same room + zone
    let chainIds: string[] = [];
    if (params.parentEntryId) {
      const parentRaw = await this.redis.get(
        this.entryKey(params.roomId, params.zoneId, params.parentEntryId),
      );
      if (parentRaw) {
        try {
          const parent = JSON.parse(parentRaw) as SharedWorkspaceEntry;
          chainIds = [...(parent.chainIds ?? []).slice(-19), params.parentEntryId];
        } catch {
          chainIds = [params.parentEntryId];
        }
      } else {
        chainIds = [params.parentEntryId];
      }
    }

    const entry: SharedWorkspaceEntry = {
      id:            randomUUID(),
      zoneId:        params.zoneId,
      roomId:        params.roomId,
      type:          params.type,
      status:        'open',
      authorAgentId: params.authorAgentId,
      targetAgentId: params.targetAgentId,
      title:         params.title.trim(),
      payload:       params.payload ?? {},
      parentEntryId: params.parentEntryId,
      chainIds,
      createdAt:     nowIso,
      updatedAt:     nowIso,
      expiresAt:     new Date(nowMs + Math.min(params.expiresInMs ?? Infinity, ttlSeconds * 1_000)).toISOString(),
    };

    const eKey = this.entryKey(params.roomId, params.zoneId, entry.id);
    const iKey = this.indexKey(params.roomId, params.zoneId);

    // Atomically write entry, index it, and refresh index TTL
    const multi = this.redis.multi();
    multi.set(eKey, JSON.stringify(entry), { EX: ttlSeconds });
    multi.zAdd(iKey, [{ score: nowMs, value: entry.id }]);
    multi.expire(iKey, DEFAULT_TTL_SECONDS);
    await multi.exec();

    // Enforce bounded capacity per (room, zone) and delete overflow entry payloads
    const totalCount = await this.redis.zCard(iKey);
    if (totalCount > MAX_ZONE_ENTRIES) {
      const overflowCount = totalCount - MAX_ZONE_ENTRIES;
      const evictedIds = await this.redis.zRange(iKey, 0, overflowCount - 1);
      if (evictedIds.length > 0) {
        const cleanup = this.redis.multi();
        cleanup.zRem(iKey, evictedIds);
        cleanup.del(evictedIds.map((id) => this.entryKey(params.roomId, params.zoneId, id)));
        await cleanup.exec();
      }
    }

    // Asynchronous durable persistence to MongoDB
    if (mongoose.connection.readyState === 1) {
      WorkspaceEntryModel.create(entry).catch((err: Error) => {
        logger.warn({ err: err.message, entryId: entry.id }, 'SharedWorkspace Mongo write failed');
      });
    }

    this.broadcast(params.roomId, entry, 'created');
    return entry;
  }

  /* ─── UPDATE STATUS ─────────────────────────────────────── */
  async updateStatus(
    zoneId:        string,
    roomId:        string,
    entryId:       string,
    status:        SharedWorkspaceEntryStatus,
    extraPayload?: Record<string, unknown>,
  ): Promise<SharedWorkspaceEntry | null> {
    const eKey = this.entryKey(roomId, zoneId, entryId);
    const raw = await this.redis.get(eKey);
    if (!raw) return null;

    let entry: SharedWorkspaceEntry;
    try {
      entry = JSON.parse(raw) as SharedWorkspaceEntry;
    } catch {
      return null;
    }

    // Defense-in-depth tenant assertion
    if (entry.roomId !== roomId || entry.zoneId !== zoneId) {
      logger.warn({ roomId, zoneId, entryId }, 'Blocked cross-room workspace update attempt');
      return null;
    }

    entry.status    = status;
    entry.updatedAt = new Date().toISOString();
    if (extraPayload) {
      entry.payload = { ...entry.payload, ...extraPayload };
    }

    const saved = await this.redis.set(eKey, JSON.stringify(entry), { KEEPTTL: true, condition: 'XX' });
    if (!saved) return null;

    if (mongoose.connection.readyState === 1) {
      WorkspaceEntryModel.updateOne(
        { id: entryId, roomId, zoneId },
        { $set: { status, updatedAt: entry.updatedAt, payload: entry.payload } },
      ).catch((err: Error) => {
        logger.warn({ err: err.message, entryId }, 'SharedWorkspace Mongo status update failed');
      });
    }

    const action: WorkspaceUpdatePayload['action'] =
      status === 'claimed'                     ? 'claimed'
      : status === 'approved' || status === 'done' ? 'completed'
      : status === 'rejected'                  ? 'rejected'
      : 'updated';

    this.broadcast(roomId, entry, action);
    return entry;
  }

  /* ─── READ ZONE (SINGLE MGET — ZERO N+1) ────────────────── */
  async getZoneWorkspace(zoneId: string, roomId: string): Promise<SharedWorkspaceState> {
    const iKey = this.indexKey(roomId, zoneId);
    const ids = await this.redis.zRange(iKey, 0, MAX_ZONE_ENTRIES - 1, { REV: true });

    if (ids.length === 0) {
      return {
        zoneId,
        roomId,
        entries:       [],
        lastWriteAt:   new Date().toISOString(),
        lastWrittenBy: '',
      };
    }

    const keys = ids.map((id) => this.entryKey(roomId, zoneId, id));
    const rawValues = await this.redis.mGet(keys);

    const entries: SharedWorkspaceEntry[] = [];
    const expiredIds: string[] = [];
    const nowMs = Date.now();

    rawValues.forEach((raw, idx) => {
      const id = ids[idx];
      if (!raw) {
        if (id) expiredIds.push(id);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as SharedWorkspaceEntry;
        if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= nowMs) {
          if (id) expiredIds.push(id);
          return;
        }
        // Return in chronological order (oldest → newest) to align with live appends
        entries.push(parsed);
      } catch {
        if (id) expiredIds.push(id);
      }
    });

    // Lazily prune expired/corrupt member IDs from the sorted set
    if (expiredIds.length > 0) {
      this.redis.zRem(iKey, expiredIds).catch(() => {});
    }

    const newestEntry = entries[0];
    entries.reverse();

    return {
      zoneId,
      roomId,
      entries,
      lastWriteAt:   newestEntry?.updatedAt ?? new Date().toISOString(),
      lastWrittenBy: newestEntry?.authorAgentId ?? '',
    };
  }

  /* ─── MULTI-ZONE READ ───────────────────────────────────── */
  async getRoomWorkspaces(zoneIds: readonly string[], roomId: string): Promise<SharedWorkspaceState[]> {
    return Promise.all(zoneIds.map((zoneId) => this.getZoneWorkspace(zoneId, roomId)));
  }

  /* ─── BROADCAST & LIFECYCLE ─────────────────────────────── */
  private broadcast(
    roomId: string,
    entry: SharedWorkspaceEntry,
    action: WorkspaceUpdatePayload['action'],
  ): void {
    const payload: WorkspaceUpdatePayload = {
      zoneId: entry.zoneId,
      roomId,
      entry,
      action,
    };
    this.io.to(roomId).emit('workspace:update', payload);
  }

  isReady(): boolean {
    return this.redis.isReady;
  }

  async disconnect(): Promise<void> {
    if (this.ownsClient && this.redis.isOpen) {
      await this.redis.quit();
    }
  }
}
