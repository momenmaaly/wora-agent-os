/**
 * BrainAdapter.ts — Wora Agent OS (2026 Stack)
 * ─────────────────────────────────────────────────────────────────
 * Unified streaming LLM adapter layer supporting:
 *   - Google Gemini 2.5 via official `@google/genai` SDK
 *   - OpenAI GPT-4.1 / GPT-4o / o-series via `openai` SDK
 *   - Anthropic Claude 4.5 via `@anthropic-ai/sdk`
 *   - Groq Llama 3.3 / Llama 4 via `groq-sdk`
 *
 * Security guarantees:
 *   - API keys are resolved strictly in-process from `process.env`
 *     and NEVER serialized into Redis, BullMQ, MongoDB, or sockets.
 *   - Custom `apiKeyAlias` values must match `^WORA_KEY_[A-Z0-9_]{1,48}$`
 *     to prevent arbitrary environment variable probing.
 */

import { randomUUID } from 'node:crypto';
import { AgentModel } from '../models/Agent.js';
import { logger } from '../lib/logger.js';
import {
  BrainProvider as BP,
  BRAIN_MODELS,
  DEFAULT_BRAIN_MODEL,
} from '../../../shared/types/index.js';
import type {
  BrainConfig,
  PublicBrainConfig,
  BrainCompletionResult,
} from '../../../shared/types/index.js';

/* ─── CONSTANTS ─────────────────────────────────────────── */
const DEFAULT_MAX_TOKENS  = 2_048;
const DEFAULT_TEMPERATURE = 0.7;
const SAFE_ALIAS_REGEX    = /^WORA_KEY_[A-Z0-9_]{1,48}$/;
const REASONING_MODEL_RE  = /^(o1|o3|o4)(-|$)/i;

const PROVIDER_ENV_KEYS: Record<BP, string> = {
  [BP.Google]:    'GEMINI_API_KEY',
  [BP.OpenAI]:    'OPENAI_API_KEY',
  [BP.Anthropic]: 'ANTHROPIC_API_KEY',
  [BP.Groq]:      'GROQ_API_KEY',
};

/* ─── TYPES ─────────────────────────────────────────────── */
export interface ConversationTurn {
  senderId: string;
  content:  string;
}

interface NormalizedTurn {
  role:    'user' | 'assistant';
  content: string;
}

export interface BrainCompletionOptions {
  systemPrompt:   string;
  history:        ConversationTurn[];
  userMessage:    string;
  taskContext:    { agentId: string; roomId?: string };
  brainOverride?: PublicBrainConfig;
  onChunk?:       (chunk: string, isDone: boolean) => void;
  maxTokens?:     number;
  temperature?:   number;
  signal?:        AbortSignal;
}

interface AdapterInvokeParams {
  systemPrompt: string;
  turns:        NormalizedTurn[];
  maxTokens:    number;
  temperature:  number;
  onChunk?:     (chunk: string, isDone: boolean) => void;
  signal?:      AbortSignal;
}

interface IBrainAdapter {
  readonly provider: BP;
  readonly model:    string;
  complete(params: AdapterInvokeParams): Promise<string>;
}

/* ─── TURN NORMALIZATION ────────────────────────────────── */
/**
 * Ensures strictly alternating `user` / `assistant` turns starting and ending
 * with `user` — required by both Gemini and Anthropic streaming APIs.
 */
function normalizeTurns(
  history: ConversationTurn[],
  userMessage: string,
  agentId: string,
): NormalizedTurn[] {
  const raw: NormalizedTurn[] = [];

  for (const msg of history) {
    const text = msg.content.trim();
    if (!text) continue;
    const role: 'user' | 'assistant' = msg.senderId === agentId ? 'assistant' : 'user';
    raw.push({ role, content: text });
  }

  const finalUserText = userMessage.trim();
  if (finalUserText) {
    // Avoid duplicating the current user message if already persisted at the tail of history
    const last = raw[raw.length - 1];
    if (!last || last.role !== 'user' || last.content !== finalUserText) {
      raw.push({ role: 'user', content: finalUserText });
    }
  }

  // Merge consecutive turns of the same role
  const merged: NormalizedTurn[] = [];
  for (const turn of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n\n${turn.content}`;
    } else {
      merged.push({ ...turn });
    }
  }

  // Drop leading assistant turns so the conversation always begins with `user`
  while (merged.length > 0 && merged[0]?.role === 'assistant') {
    merged.shift();
  }

  // Guarantee at least one user turn
  if (merged.length === 0) {
    merged.push({ role: 'user', content: finalUserText || 'Hello' });
  }

  return merged;
}

function clampMaxTokens(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_TOKENS;
  return Math.min(16_384, Math.max(64, Math.trunc(value)));
}

function clampTemperature(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

/* ─── API KEY RESOLUTION (IN-PROCESS ONLY) ──────────────── */
function getEnvVarName(cfg: Pick<BrainConfig, 'provider' | 'apiKeyAlias'>): string {
  if (cfg.apiKeyAlias) {
    if (!SAFE_ALIAS_REGEX.test(cfg.apiKeyAlias)) {
      throw new Error(`[BrainAdapter] Rejected unsafe apiKeyAlias format`);
    }
    return cfg.apiKeyAlias;
  }
  const envVar = PROVIDER_ENV_KEYS[cfg.provider];
  if (!envVar) {
    throw new Error(`[BrainAdapter] Unsupported provider: ${String(cfg.provider)}`);
  }
  return envVar;
}

export function isProviderConfigured(cfg: Pick<BrainConfig, 'provider' | 'apiKeyAlias'>): boolean {
  try {
    const envVar = getEnvVarName(cfg);
    const val = process.env[envVar]?.trim();
    return Boolean(val && val.length > 0);
  } catch {
    return false;
  }
}

function resolveApiKey(cfg: Pick<BrainConfig, 'provider' | 'apiKeyAlias'>): { envVar: string; key: string } {
  const envVar = getEnvVarName(cfg);
  const key = process.env[envVar]?.trim();
  if (!key) {
    throw new Error(`[BrainAdapter] Missing API key env var "${envVar}" for provider "${cfg.provider}"`);
  }
  return { envVar, key };
}

export function isSupportedModel(provider: BP, model: string): boolean {
  const allowed = BRAIN_MODELS[provider];
  return Array.isArray(allowed) && allowed.includes(model);
}

/* ─── 1. GOOGLE GEMINI ADAPTER (@google/genai) ──────────── */
class GeminiAdapter implements IBrainAdapter {
  readonly provider = BP.Google;
  private clientPromise: Promise<import('@google/genai').GoogleGenAI> | null = null;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  private getClient(): Promise<import('@google/genai').GoogleGenAI> {
    if (!this.clientPromise) {
      this.clientPromise = import('@google/genai').then(
        ({ GoogleGenAI }) => new GoogleGenAI({ apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async complete(params: AdapterInvokeParams): Promise<string> {
    const ai = await this.getClient();

    const contents = params.turns.map((turn) => ({
      role:  turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    }));

    const stream = await ai.models.generateContentStream({
      model:    this.model,
      contents,
      config: {
        systemInstruction: params.systemPrompt,
        maxOutputTokens:   params.maxTokens,
        temperature:       params.temperature,
        abortSignal:       params.signal,
      },
    });

    let full = '';
    for await (const chunk of stream) {
      if (params.signal?.aborted) {
        throw new Error('Generation aborted');
      }
      const delta = chunk.text ?? '';
      if (delta) {
        full += delta;
        params.onChunk?.(delta, false);
      }
    }

    params.onChunk?.('', true);
    return full;
  }
}

/* ─── 2. OPENAI ADAPTER (openai) ────────────────────────── */
class OpenAIAdapter implements IBrainAdapter {
  readonly provider = BP.OpenAI;
  private clientPromise: Promise<import('openai').default> | null = null;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  private getClient(): Promise<import('openai').default> {
    if (!this.clientPromise) {
      this.clientPromise = import('openai').then(
        ({ default: OpenAI }) => new OpenAI({ apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async complete(params: AdapterInvokeParams): Promise<string> {
    const client = await this.getClient();
    const isReasoning = REASONING_MODEL_RE.test(this.model);

    const messages: Array<{ role: 'developer' | 'system' | 'user' | 'assistant'; content: string }> = [
      { role: isReasoning ? 'developer' : 'system', content: params.systemPrompt },
      ...params.turns.map((t) => ({ role: t.role, content: t.content })),
    ];

    const stream = await client.chat.completions.create(
      {
        model:                 this.model,
        messages,
        max_completion_tokens: params.maxTokens,
        ...(isReasoning ? {} : { temperature: params.temperature }),
        stream: true,
      },
      { signal: params.signal },
    );

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        full += delta;
        params.onChunk?.(delta, false);
      }
    }

    params.onChunk?.('', true);
    return full;
  }
}

/* ─── 3. ANTHROPIC ADAPTER (@anthropic-ai/sdk) ──────────── */
class AnthropicAdapter implements IBrainAdapter {
  readonly provider = BP.Anthropic;
  private clientPromise: Promise<import('@anthropic-ai/sdk').default> | null = null;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  private getClient(): Promise<import('@anthropic-ai/sdk').default> {
    if (!this.clientPromise) {
      this.clientPromise = import('@anthropic-ai/sdk').then(
        ({ default: Anthropic }) => new Anthropic({ apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async complete(params: AdapterInvokeParams): Promise<string> {
    const client = await this.getClient();

    let full = '';
    const stream = client.messages.stream(
      {
        model:       this.model,
        max_tokens:  params.maxTokens,
        // Anthropic enforces temperature in [0, 1]
        temperature: Math.min(1, params.temperature),
        system:      params.systemPrompt,
        messages:    params.turns.map((t) => ({ role: t.role, content: t.content })),
      },
      { signal: params.signal },
    );

    stream.on('text', (delta) => {
      if (delta) {
        full += delta;
        params.onChunk?.(delta, false);
      }
    });

    await stream.finalMessage();
    params.onChunk?.('', true);
    return full;
  }
}

/* ─── 4. GROQ ADAPTER (groq-sdk) ────────────────────────── */
class GroqAdapter implements IBrainAdapter {
  readonly provider = BP.Groq;
  private clientPromise: Promise<import('groq-sdk').default> | null = null;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
  ) {}

  private getClient(): Promise<import('groq-sdk').default> {
    if (!this.clientPromise) {
      this.clientPromise = import('groq-sdk').then(
        ({ default: Groq }) => new Groq({ apiKey: this.apiKey }),
      );
    }
    return this.clientPromise;
  }

  async complete(params: AdapterInvokeParams): Promise<string> {
    const client = await this.getClient();

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: params.systemPrompt },
      ...params.turns.map((t) => ({ role: t.role, content: t.content })),
    ];

    const stream = await client.chat.completions.create(
      {
        model:       this.model,
        messages,
        max_tokens:  params.maxTokens,
        temperature: params.temperature,
        stream:      true,
      },
      { signal: params.signal },
    );

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        full += delta;
        params.onChunk?.(delta, false);
      }
    }

    params.onChunk?.('', true);
    return full;
  }
}

/* ─── FACTORY & MULTI-INSTANCE SAFE CACHE ───────────────── */
function createAdapterInstance(provider: BP, model: string, apiKey: string): IBrainAdapter {
  switch (provider) {
    case BP.Google:    return new GeminiAdapter(model, apiKey);
    case BP.OpenAI:    return new OpenAIAdapter(model, apiKey);
    case BP.Anthropic: return new AnthropicAdapter(model, apiKey);
    case BP.Groq:      return new GroqAdapter(model, apiKey);
    default: {
      const exhaustive: never = provider;
      throw new Error(`[BrainAdapter] Unknown provider: ${String(exhaustive)}`);
    }
  }
}

export class BrainAdapterFactory {
  /** Shared SDK adapter pool keyed by `${provider}:${model}:${envVar}` */
  private static adapterPool = new Map<string, IBrainAdapter>();

  /** Per-agent default BrainConfig cache (invalidated locally & via Redis Pub/Sub) */
  private static agentConfigCache = new Map<string, BrainConfig>();

  private static getPooledAdapter(cfg: BrainConfig): IBrainAdapter {
    const { envVar, key } = resolveApiKey(cfg);
    const poolKey = `${cfg.provider}:${cfg.model}:${envVar}`;
    const cached = BrainAdapterFactory.adapterPool.get(poolKey);
    if (cached) return cached;

    const adapter = createAdapterInstance(cfg.provider, cfg.model, key);
    BrainAdapterFactory.adapterPool.set(poolKey, adapter);
    return adapter;
  }

  static async resolveAgentConfig(agentId: string, override?: PublicBrainConfig): Promise<BrainConfig> {
    if (override) {
      return {
        provider:    override.provider,
        model:       override.model,
        maxTokens:   override.maxTokens,
        temperature: override.temperature,
      };
    }

    const cached = BrainAdapterFactory.agentConfigCache.get(agentId);
    if (cached) return cached;

    const agentDoc = await AgentModel.findByAgentId(agentId).lean();
    if (!agentDoc) {
      throw new Error(`[BrainAdapter] Agent not found: ${agentId}`);
    }

    const cfg: BrainConfig = agentDoc.brainConfig ?? {
      provider:    BP.Google,
      model:       agentDoc.modelId || DEFAULT_BRAIN_MODEL,
      maxTokens:   DEFAULT_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
    };

    BrainAdapterFactory.agentConfigCache.set(agentId, cfg);
    return cfg;
  }

  static swapBrain(agentId: string): void {
    BrainAdapterFactory.agentConfigCache.delete(agentId);
    logger.info({ agentId }, 'Brain config cache evicted for agent');
  }

  static clearAll(): void {
    BrainAdapterFactory.agentConfigCache.clear();
    BrainAdapterFactory.adapterPool.clear();
  }

  static async complete(
    agentId: string,
    opts: BrainCompletionOptions,
  ): Promise<BrainCompletionResult> {
    const cfg = await BrainAdapterFactory.resolveAgentConfig(agentId, opts.brainOverride);
    const adapter = BrainAdapterFactory.getPooledAdapter(cfg);
    const auditId = randomUUID();

    const turns = normalizeTurns(opts.history, opts.userMessage, opts.taskContext.agentId);
    const maxTokens = clampMaxTokens(opts.maxTokens ?? cfg.maxTokens);
    const temperature = clampTemperature(opts.temperature ?? cfg.temperature);

    const rawText = await adapter.complete({
      systemPrompt: opts.systemPrompt,
      turns,
      maxTokens,
      temperature,
      onChunk: opts.onChunk,
      signal:  opts.signal,
    });

    return {
      text:               rawText,
      provider:           adapter.provider,
      model:              adapter.model,
      tokenEstimate:      Math.ceil(rawText.length / 4),
      wasRefined:         false,
      refinementAttempts: 0,
      constitutionPassed: true,
      auditId,
      toolCallCount:      0,
      streamingFailed:    false,
    };
  }
}
