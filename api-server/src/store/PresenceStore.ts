import type { RedisClientType } from 'redis';

const PREFIX = 'wora:presence';
const TTL_SECONDS = 3_600; // 1 hour

export interface PresenceEntry {
  participantId: string;
  roomId:        string;
  position:      { x: number; y: number; z: number };
  joinedAt:      string;
  lastSeen?:     string;
}

/** Lua script for atomic presence position update without GET+SETEX race condition */
const ATOMIC_UPDATE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
data.position = cjson.decode(ARGV[1])
data.lastSeen = ARGV[2]
redis.call('SETEX', KEYS[1], tonumber(ARGV[3]), cjson.encode(data))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
return 1
`;

export class PresenceStore {
  constructor(private readonly redis: RedisClientType) {}

  private key(roomId: string, pid: string): string {
    return `${PREFIX}:${roomId}:${pid}`;
  }

  private roomKey(roomId: string): string {
    return `${PREFIX}:${roomId}:members`;
  }

  async set(roomId: string, pid: string, entry: PresenceEntry): Promise<void> {
    const multi = this.redis.multi();
    multi.setEx(this.key(roomId, pid), TTL_SECONDS, JSON.stringify(entry));
    multi.sAdd(this.roomKey(roomId), pid);
    multi.expire(this.roomKey(roomId), TTL_SECONDS);
    await multi.exec();
  }

  async update(roomId: string, pid: string, position: { x: number; y: number; z: number }): Promise<void> {
    const now = new Date().toISOString();
    await this.redis.eval(ATOMIC_UPDATE_LUA, {
      keys:      [this.key(roomId, pid), this.roomKey(roomId)],
      arguments: [JSON.stringify(position), now, String(TTL_SECONDS)],
    });
  }

  async remove(roomId: string, pid: string): Promise<void> {
    const multi = this.redis.multi();
    multi.del(this.key(roomId, pid));
    multi.sRem(this.roomKey(roomId), pid);
    await multi.exec();
  }

  async getRoom(roomId: string): Promise<PresenceEntry[]> {
    const rKey = this.roomKey(roomId);
    const members = await this.redis.sMembers(rKey);
    if (members.length === 0) return [];

    const rawList = await this.redis.mGet(members.map((pid) => this.key(roomId, pid)));
    const entries: PresenceEntry[] = [];
    const staleMembers: string[] = [];

    rawList.forEach((raw, idx) => {
      if (!raw) {
        const pid = members[idx];
        if (pid) staleMembers.push(pid);
        return;
      }
      try {
        entries.push(JSON.parse(raw) as PresenceEntry);
      } catch {
        const pid = members[idx];
        if (pid) staleMembers.push(pid);
      }
    });

    if (staleMembers.length > 0) {
      this.redis.sRem(rKey, staleMembers).catch(() => {});
    }

    return entries;
  }

  async getRoomCount(roomId: string): Promise<number> {
    return this.redis.sCard(this.roomKey(roomId));
  }

  async flushRoom(roomId: string): Promise<void> {
    const rKey = this.roomKey(roomId);
    const members = await this.redis.sMembers(rKey);
    const keys = members.map((pid) => this.key(roomId, pid));
    keys.push(rKey);
    await this.redis.del(keys);
  }
}
