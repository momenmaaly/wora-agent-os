import type { RedisClientType } from 'redis';
import { AgentLifecycleState, lifecycleToAvatarState } from '../../../shared/types/index.js';

type RuntimeSignal = { state: AgentLifecycleState; revision: number };
type StoredSignal = { jobs?: Record<string, { state: AgentLifecycleState; expiresAt: number }>; revision: string; failedUntil?: number };
const ranks: Partial<Record<AgentLifecycleState, number>> = {
  [AgentLifecycleState.Responding]: 3, [AgentLifecycleState.Thinking]: 2, [AgentLifecycleState.Refining]: 1,
};

// Keep overlap/retry state private to the workspace and atomic across BullMQ workers.
const update = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local doc = cjson.decode(redis.call('GET', KEYS[1]) or '{}')
local jobs = doc.jobs or {}
local ranks = cjson.decode(ARGV[4])
local id, state = ARGV[1], ARGV[2]
local failedUntil = doc.failedUntil or 0
if state == 'IDLE' or state == 'ERROR' then
  jobs[id] = nil
  if state == 'ERROR' then failedUntil = now + 900000 end
else
  if state == 'THINKING' then failedUntil = 0 end
  jobs[id] = { state = state, expiresAt = now + tonumber(ARGV[3]) }
end
local rank = 0
local aggregate = failedUntil > now and 'ERROR' or 'IDLE'
for job, entry in pairs(jobs) do
  if entry.expiresAt <= now then
    jobs[job] = nil
  elseif (ranks[entry.state] or 0) > rank then
    aggregate = entry.state
    rank = ranks[aggregate]
  end
end
local micros = tonumber(time[1]) * 1000000 + tonumber(time[2])
local rev = string.format('%.0f', math.max(micros, tonumber(doc.revision or '0') + 1))
redis.call('SET', KEYS[1], cjson.encode({ jobs = jobs, failedUntil = failedUntil, revision = rev }), 'PX', 900000)
return {aggregate, rev}
`;

export class AgentRuntimeStore {
  constructor(private readonly redis: RedisClientType) {}

  private key(roomId: string, agentId: string) { return `wora:runtime:${roomId}:${agentId}`; }

  async report(roomId: string, agentId: string, jobId: string, state: AgentLifecycleState, jobTtlMs: number) {
    const [next, stamp] = await this.redis.withCommandOptions({ abortSignal: AbortSignal.timeout(1_500) }).eval(update, {
      keys: [this.key(roomId, agentId)], arguments: [jobId, state, String(jobTtlMs), JSON.stringify(ranks)],
    }) as [AgentLifecycleState, string];
    return { roomId, agentId, state: next, avatarState: lifecycleToAvatarState(next), revision: Number(stamp) };
  }

  async snapshot(roomId: string, agentIds: readonly string[]) {
    const signals = new Map<string, RuntimeSignal>();
    if (!agentIds.length) return signals;
    const raw = await this.redis.withCommandOptions({ abortSignal: AbortSignal.timeout(1_500) }).mGet(agentIds.map((agentId) => this.key(roomId, agentId)));
    const now = Date.now();
    for (let i = 0; i < raw.length; i++) {
      const json = raw[i];
      if (!json) continue;
      try {
        const doc = JSON.parse(json) as StoredSignal;
        let state = (doc.failedUntil ?? 0) > now ? AgentLifecycleState.Error : AgentLifecycleState.Idle;
        let rank = 0;
        for (const job of Object.values(doc.jobs ?? {})) {
          const priority = ranks[job.state] ?? 0;
          if (job.expiresAt > now && priority > rank) { state = job.state; rank = priority; }
        }
        signals.set(agentIds[i]!, { state, revision: Number(doc.revision) });
      } catch { /* Ignore corrupt, expired runtime entries; task records stay authoritative. */ }
    }
    return signals;
  }
}
