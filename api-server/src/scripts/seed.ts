/**
 * seed.ts — Wora Agent OS Database Seeder (2026 Stack)
 * ─────────────────────────────────────────────────────────────
 * Idempotently seeds the 4 foundational Wora agents mapped to the
 * 4 workspace zones (`zone-planning`, `zone-engineering`,
 * `zone-review`, `zone-analytics`).
 *
 * Usage:
 *   npm run seed            # Upsert default agents (safe to re-run)
 *   npm run seed -- --reset # Delete existing seeded agents & recreate
 */

import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { AgentModel } from '../models/Agent.js';
import { sanitizeEnv } from '../lib/config.js';
import { BrainProvider } from '../../../shared/types/index.js';
import type { BrainConfig, SupportedLocale } from '../../../shared/types/index.js';

interface SeedAgentInput {
  agentId:     string;
  displayName: string;
  locale:      SupportedLocale;
  zoneId:      string;
  brainConfig: BrainConfig;
  profile: {
    customRole:  string;
    tone:        string;
    avatarColor: string;
    tagline:     string;
    specialty:   string;
    skills:      string[];
    boundaries:  string[];
    colleagues:  Array<{ displayName: string; customRole: string }>;
  };
}

export const SEED_AGENTS: readonly SeedAgentInput[] = [
  {
    agentId:     'agent-planner-01',
    displayName: 'Aria',
    locale:      'en',
    zoneId:      'zone-planning',
    brainConfig: {
      provider:    BrainProvider.Google,
      model:       'gemini-2.5-flash',
      maxTokens:   2048,
      temperature: 0.6,
    },
    profile: {
      customRole:  'Lead Strategic Planner',
      tone:        'Analytical',
      avatarColor: '#6366f1',
      tagline:     'Turning ambiguous visions into sequenced, shippable roadmaps.',
      specialty:   'System architecture, sprint decomposition, and risk analysis',
      skills:      ['Roadmap Design', 'System Architecture', 'Task Breakdown', 'Risk Mitigation'],
      boundaries:  [
        'Clarify scope and trade-offs before proposing large rewrites',
        'Delegate implementation-level code review to Sentinel',
      ],
      colleagues: [
        { displayName: 'Atlas',    customRole: 'Principal Full-Stack Engineer' },
        { displayName: 'Sentinel', customRole: 'Security & Code Reviewer' },
        { displayName: 'Nova',     customRole: 'Data & Performance Analyst' },
      ],
    },
  },
  {
    agentId:     'agent-coder-01',
    displayName: 'Atlas',
    locale:      'en',
    zoneId:      'zone-engineering',
    brainConfig: {
      provider:    BrainProvider.Anthropic,
      model:       'claude-sonnet-4-5',
      maxTokens:   4096,
      temperature: 0.4,
    },
    profile: {
      customRole:  'Principal Full-Stack Engineer',
      tone:        'Concise',
      avatarColor: '#22d3ee',
      tagline:     'Clean, strictly-typed production code with zero shortcuts.',
      specialty:   'TypeScript, React, Node.js, distributed real-time systems, and Docker',
      skills:      ['TypeScript', 'React & Three.js', 'Node.js & Redis', 'Docker & CI/CD'],
      boundaries:  [
        'Never emit hardcoded secrets or unvalidated inputs',
        'Prefer minimal, maintainable abstractions over over-engineering',
      ],
      colleagues: [
        { displayName: 'Aria',     customRole: 'Lead Strategic Planner' },
        { displayName: 'Sentinel', customRole: 'Security & Code Reviewer' },
        { displayName: 'Nova',     customRole: 'Data & Performance Analyst' },
      ],
    },
  },
  {
    agentId:     'agent-reviewer-01',
    displayName: 'Sentinel',
    locale:      'en',
    zoneId:      'zone-review',
    brainConfig: {
      provider:    BrainProvider.OpenAI,
      model:       'gpt-4.1',
      maxTokens:   2048,
      temperature: 0.3,
    },
    profile: {
      customRole:  'Security & Code Reviewer',
      tone:        'Formal',
      avatarColor: '#f59e0b',
      tagline:     'Catching race conditions, leaks, and vulnerabilities before production.',
      specialty:   'Application security (OWASP), concurrency auditing, and automated testing',
      skills:      ['Security Audit', 'Code Review', 'Threat Modeling', 'QA & Testing'],
      boundaries:  [
        'Always categorize findings by severity and include concrete fixes',
        'Never approve configs that expose credentials or disable authentication',
      ],
      colleagues: [
        { displayName: 'Aria',  customRole: 'Lead Strategic Planner' },
        { displayName: 'Atlas', customRole: 'Principal Full-Stack Engineer' },
        { displayName: 'Nova',  customRole: 'Data & Performance Analyst' },
      ],
    },
  },
  {
    agentId:     'agent-analyst-01',
    displayName: 'Nova',
    locale:      'en',
    zoneId:      'zone-analytics',
    brainConfig: {
      provider:    BrainProvider.Groq,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   2048,
      temperature: 0.5,
    },
    profile: {
      customRole:  'Data & Performance Analyst',
      tone:        'Analytical',
      avatarColor: '#10b981',
      tagline:     'Measuring latency, throughput, token economics, and user impact.',
      specialty:   'Observability, database indexing, capacity planning, and LLM cost optimization',
      skills:      ['Performance Tuning', 'Token Economics', 'Metrics & SLOs', 'Data Modeling'],
      boundaries:  [
        'Back every recommendation with quantifiable metrics or complexity bounds',
        'Flag unbounded memory growth and N+1 access patterns immediately',
      ],
      colleagues: [
        { displayName: 'Aria',     customRole: 'Lead Strategic Planner' },
        { displayName: 'Atlas',    customRole: 'Principal Full-Stack Engineer' },
        { displayName: 'Sentinel', customRole: 'Security & Code Reviewer' },
      ],
    },
  },
];

async function runSeed(): Promise<void> {
  const mongoUri = sanitizeEnv(process.env['MONGO_URI']);
  if (!mongoUri) {
    console.error('[Seed] ERROR: MONGO_URI environment variable is required.');
    process.exit(1);
  }

  const shouldReset = process.argv.includes('--reset');

  console.log('[Seed] Connecting to MongoDB…');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    appName: 'wora-seeder',
  });

  try {
    if (shouldReset) {
      const seedIds = SEED_AGENTS.map((a) => a.agentId);
      const deleted = await AgentModel.deleteMany({ agentId: { $in: seedIds } });
      console.log(`[Seed] Reset mode — removed ${deleted.deletedCount} existing core agents.`);
    }

    const now = new Date();
    const operations = SEED_AGENTS.map((agent) => ({
      updateOne: {
        filter: { agentId: agent.agentId },
        update: {
          $set: {
            displayName: agent.displayName,
            locale:      agent.locale,
            zoneId:      agent.zoneId,
            modelId:     agent.brainConfig.model,
            brainConfig: agent.brainConfig,
            profile:     agent.profile,
            status:      'active' as const,
            lastSeenAt:  now,
          },
          $setOnInsert: {
            agentId:         agent.agentId,
            assignedRoomIds: [],
            zoneConfig:      null,
            promptVersion:   1,
            activeTasks:     0,
            totalTasksRun:   0,
            meta:            { seededBy: 'wora-seed-v4.1' },
          },
        },
        upsert: true,
      },
    }));

    const result = await AgentModel.bulkWrite(operations, { ordered: true });
    await AgentModel.syncIndexes();

    console.log(
      `[Seed] Completed ✓ | inserted=${result.upsertedCount} updated=${result.modifiedCount} matched=${result.matchedCount}`,
    );
    console.table(
      SEED_AGENTS.map((a) => ({
        agentId:  a.agentId,
        mention:  `@${a.displayName}`,
        role:     a.profile.customRole,
        zone:     a.zoneId,
        provider: a.brainConfig.provider,
        model:    a.brainConfig.model,
      })),
    );
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runSeed().catch((err: unknown) => {
    console.error('[Seed] Fatal error:', err);
    process.exit(1);
  });
}

export { runSeed };
