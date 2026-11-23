/**
 * WORA OS — AI usage & cost ledger.
 *
 * Every provider completion flows through BrainAdapterFactory.complete(); this
 * module records an estimate of the tokens (input ≈ chars/4 over system+turns,
 * output ≈ chars/4 over the completion) and a cost estimate from an
 * operator-overridable price catalog. Figures are ESTIMATES from text length —
 * they exist for budgeting and anomaly detection, not billing reconciliation.
 *
 * Recording never throws and never blocks a completion: a ledger failure is
 * logged and swallowed.
 */
import { getOsDb, newId, nowIso } from './db.js';
import { logger } from '../lib/logger.js';

/** Approximate public per-1K-token USD prices { in, out }. Override with WORA_PRICE_JSON env (JSON object keyed "provider:model"). Unknown models → cost null. */
const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  'google:gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'google:gemini-2.5-pro': { in: 1.25, out: 10.0 },
  'google:gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'openai:gpt-4o-mini': { in: 0.15, out: 0.6 },
  'openai:gpt-4o': { in: 2.5, out: 10.0 },
  'anthropic:claude-sonnet-4': { in: 3.0, out: 15.0 },
  'anthropic:claude-haiku-3.5': { in: 0.8, out: 4.0 },
  'groq:llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'groq:llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
};

function priceCatalog(): Record<string, { in: number; out: number }> {
  const raw = process.env['WORA_PRICE_JSON'];
  if (!raw) return DEFAULT_PRICES;
  try {
    const parsed = JSON.parse(raw) as Record<string, { in: number; out: number }>;
    return { ...DEFAULT_PRICES, ...parsed };
  } catch {
    logger.warn('WORA_PRICE_JSON is not valid JSON; falling back to built-in approximate catalog');
    return DEFAULT_PRICES;
  }
}

export function estimateCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number | null {
  const price = priceCatalog()[`${provider}:${model}`.toLowerCase()];
  if (!price) return null;
  return Number((((inputTokens * price.in) + (outputTokens * price.out)) / 1000).toFixed(6));
}

export function recordAiUsage(entry: {
  provider: string; model: string; agentId?: string; auditId?: string;
  inputTokens: number; outputTokens: number;
}): void {
  try {
    const db = getOsDb();
    db.prepare('INSERT INTO os_ai_usage (id, actor, agent_id, provider, model, input_tokens_est, output_tokens_est, cost_usd, audit_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('usage'), 'brain', entry.agentId ?? '', entry.provider, entry.model,
        Math.max(0, Math.round(entry.inputTokens)), Math.max(0, Math.round(entry.outputTokens)),
        estimateCostUsd(entry.provider, entry.model, entry.inputTokens, entry.outputTokens),
        entry.auditId ?? '', nowIso());
  } catch (err) {
    logger.warn({ err }, 'AI usage ledger write failed (completion unaffected)');
  }
}

export function getAiUsageSummary(days = 30) {
  const db = getOsDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const totals = db.prepare(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(input_tokens_est),0) AS inputTokens,
      COALESCE(SUM(output_tokens_est),0) AS outputTokens,
      COALESCE(SUM(cost_usd),0) AS costUsd
    FROM os_ai_usage WHERE created_at >= ?`).get(since) as { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  const byProvider = db.prepare(`SELECT provider, model, COUNT(*) AS calls,
      COALESCE(SUM(input_tokens_est),0) AS inputTokens, COALESCE(SUM(output_tokens_est),0) AS outputTokens, COALESCE(SUM(cost_usd),0) AS costUsd
    FROM os_ai_usage WHERE created_at >= ? GROUP BY provider, model ORDER BY calls DESC LIMIT 20`).all(since) as unknown as Array<Record<string, unknown>>;
  return {
    since, days, pricingNote: 'Token figures are char/4 estimates; cost uses an approximate built-in catalog overridable via WORA_PRICE_JSON. Not billing-grade.',
    totals: { ...totals, inputTokens: Number(totals.inputTokens), outputTokens: Number(totals.outputTokens), costUsd: Number(Number(totals.costUsd).toFixed(6)) },
    byProvider,
  };
}
