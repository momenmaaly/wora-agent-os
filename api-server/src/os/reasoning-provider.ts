/**
 * WORA OS — optional reasoning-provider boundary.
 *
 * The provider proposes interpretations, hypotheses, questions, causal
 * structures and methods. It cannot execute tools, approve actions, change
 * permissions, or mark a claim verified. The deterministic reasoning engine
 * validates and merges proposals; provider failure degrades to deterministic
 * reasoning instead of blocking mission execution.
 *
 * Configure an OpenAI-compatible endpoint with:
 *   WORA_REASONING_PROVIDER=openai-compatible
 *   WORA_REASONING_BASE_URL=https://provider.example/v1
 *   WORA_REASONING_MODEL=...
 *   WORA_REASONING_API_KEY=...       (optional, never logged)
 */
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { recordAiUsage } from './usage.js';

export const REASONING_PROVIDER_SCHEMA_VERSION = '1.0';

export interface ReasoningProviderRequest {
  objective: string;
  desiredOutcome: string;
  domain: string;
  facts: Array<{ id: string; statement: string }>;
  assumptions: Array<{ id: string; statement: string }>;
  unknowns: string[];
  evidence: Array<{ id: string; statement: string; kind: string; source: string; trust: string }>;
  methods: Array<{ id: string; name: string; status: string }>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ReasoningProposal {
  desiredOutcome?: string;
  interpretation?: string;
  hypotheses?: Array<{
    statement: string;
    cause?: string;
    assumptions?: string[];
    distinguishingTests?: string[];
    evidenceIds?: string[];
  }>;
  questions?: Array<{ question: string; why: string; materiality?: 'critical' | 'high' | 'medium' | 'low' }>;
  causalEdges?: Array<{
    cause: string;
    effect: string;
    relation?: 'causes' | 'contributes' | 'correlates' | 'unknown';
    evidenceKind?: 'observational' | 'experimental' | 'assumed';
    confounders?: string[];
  }>;
  contradictions?: string[];
  methods?: Array<{ id: string; reason: string }>;
}

export interface ReasoningProviderResult {
  ok: boolean;
  proposal: ReasoningProposal | null;
  provider: { name: string; model: string | null };
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

const proposalSchema = z.object({
  desiredOutcome: z.string().trim().max(1000).optional(),
  interpretation: z.string().trim().max(2000).optional(),
  hypotheses: z.array(z.object({
    statement: z.string().trim().min(1).max(1000),
    cause: z.string().trim().max(500).optional(),
    assumptions: z.array(z.string().trim().max(500)).max(20).optional(),
    distinguishingTests: z.array(z.string().trim().max(500)).max(20).optional(),
    evidenceIds: z.array(z.string().trim().max(100)).max(30).optional(),
  })).max(12).optional(),
  questions: z.array(z.object({
    question: z.string().trim().min(1).max(1000),
    why: z.string().trim().max(1000),
    materiality: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  })).max(10).optional(),
  causalEdges: z.array(z.object({
    cause: z.string().trim().min(1).max(500),
    effect: z.string().trim().min(1).max(500),
    relation: z.enum(['causes', 'contributes', 'correlates', 'unknown']).optional(),
    evidenceKind: z.enum(['observational', 'experimental', 'assumed']).optional(),
    confounders: z.array(z.string().trim().max(300)).max(20).optional(),
  })).max(20).optional(),
  contradictions: z.array(z.string().trim().max(1000)).max(20).optional(),
  methods: z.array(z.object({ id: z.string().trim().min(1).max(100), reason: z.string().trim().max(1000) })).max(20).optional(),
}).strict();

const responseEnvelope = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
  })).min(1),
}).passthrough();

export function reasoningProviderStatus(): { configured: boolean; name: string; model: string | null; baseUrl: string | null; notice: string } {
  const provider = (process.env['WORA_REASONING_PROVIDER'] ?? '').trim().toLowerCase();
  const baseUrl = (process.env['WORA_REASONING_BASE_URL'] ?? '').trim();
  const model = (process.env['WORA_REASONING_MODEL'] ?? '').trim() || null;
  const configured = provider === 'openai-compatible' && Boolean(baseUrl) && Boolean(model);
  return {
    configured,
    name: configured ? provider : 'none',
    model,
    baseUrl: configured ? baseUrl : null,
    notice: configured
      ? 'An optional reasoning provider is configured. Its proposals remain unverified until checked by WORA.'
      : 'No reasoning model provider is configured; deterministic reasoning is active.',
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

function boundedRequest(request: ReasoningProviderRequest): string {
  const facts = request.facts.slice(0, 20).map((fact) => ({ id: fact.id, statement: truncate(fact.statement, 500) }));
  const assumptions = request.assumptions.slice(0, 20).map((item) => ({ id: item.id, statement: truncate(item.statement, 500) }));
  const evidence = request.evidence.slice(0, 20).map((item) => ({
    id: item.id, statement: truncate(item.statement, 700), kind: item.kind, source: item.source, trust: item.trust,
  }));
  return JSON.stringify({
    objective: truncate(request.objective, 4000),
    desiredOutcome: truncate(request.desiredOutcome, 1000),
    domain: request.domain,
    facts,
    assumptions,
    unknowns: request.unknowns.slice(0, 20).map((item) => truncate(item, 500)),
    evidence,
    methods: request.methods.slice(0, 30),
    instruction: 'Return only a JSON object matching the proposal contract. Do not claim verification, permissions, approvals, tool execution, or calibrated probabilities. Label hypotheses as proposals.',
  });
}

function proposalFromText(text: string): ReasoningProposal {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  const parsed = proposalSchema.parse(JSON.parse(cleaned) as unknown);
  return parsed;
}

/** Calls the configured provider with bounded context, timeout and retry limits. */
export async function proposeReasoning(request: ReasoningProviderRequest): Promise<ReasoningProviderResult> {
  const status = reasoningProviderStatus();
  const provider = { name: status.name, model: status.model };
  if (!status.configured || !status.baseUrl) {
    return { ok: false, proposal: null, provider, error: status.notice, usage: null };
  }
  const timeoutMs = Math.min(Math.max(Number(process.env['WORA_REASONING_TIMEOUT_MS']) || 12_000, 1_000), 60_000);
  const maxAttempts = Math.min(Math.max(Number(process.env['WORA_REASONING_MAX_ATTEMPTS']) || 2, 1), 3);
  const maxTokens = Math.min(Math.max(request.maxTokens ?? (Number(process.env['WORA_REASONING_MAX_TOKENS']) || 1_200), 128), 2_000);
  const endpoint = `${status.baseUrl.replace(/\/$/u, '')}/chat/completions`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = process.env['WORA_REASONING_API_KEY'];
  if (key) headers['authorization'] = `Bearer ${key}`;
  const body = JSON.stringify({
    model: status.model,
    temperature: 0.1,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a reasoning proposal component. Output concise structured JSON only. Never claim a hypothesis is verified, never grant permissions, never approve an action, and never invent evidence.' },
      { role: 'user', content: boundedRequest(request) },
    ],
  });
  let lastError = 'provider request failed';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
      if (!response.ok) {
        lastError = `provider HTTP ${response.status}`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
        continue;
      }
      const envelope = responseEnvelope.parse(await response.json() as unknown);
      const content = envelope.choices[0]?.message.content ?? '';
      const proposal = proposalFromText(content);
      const inputTokens = Math.ceil(body.length / 4);
      const outputTokens = Math.ceil(content.length / 4);
      recordAiUsage({ provider: status.name, model: status.model ?? 'unknown', inputTokens, outputTokens, auditId: 'reasoning-provider' });
      return { ok: true, proposal, provider, error: null, usage: { inputTokens, outputTokens } };
    } catch (error) {
      lastError = error instanceof Error ? (error.name === 'AbortError' ? 'provider timeout' : error.message) : 'provider error';
      logger.warn({ err: error, attempt }, 'reasoning provider proposal failed; deterministic fallback remains available');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
  return { ok: false, proposal: null, provider, error: lastError, usage: null };
}
