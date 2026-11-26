/**
 * Cloud computer and browser tools exposed to WORA agents.
 *
 * Tools are thin wrappers around the durable runtime managers. Authorization,
 * approval, audit, redaction and timeout enforcement remain in runTool().
 */
import path from 'node:path';
import { z } from 'zod';
import { assertSafeOutboundUrl } from '../lib/safe-fetch.js';
import { getOsDb, audit } from '../os/db.js';
import { redactSecrets } from '../os/secrets.js';
import type { ToolContext, ToolDefinition } from '../os/tools.js';
import {
  addRuntimeArtifact, createComputerSession, execComputer, getComputerSession, getRuntimeSession, listComputerSessions, listRuntimeArtifacts,
  listSessionFiles, readSessionFile, stopComputerSession, writeSessionFile, type RuntimeSession,
} from './cloud.js';
import {
  browserClick, browserInspect, browserOpen, browserResearch, browserScroll, browserSelect, browserScreenshot,
  browserType, browserWait, closeBrowserSession, createBrowserSession, getBrowserSession, listBrowserSessions,
} from './browser.js';
import { financialIntent } from './financial.js';
import { assertRuntimeSessionAccess, canAccessRuntimeSession } from './auth.js';

function principal(ctx: ToolContext): string {
  return ctx.requestedBy?.trim() || ctx.actor;
}

function publicSession(session: RuntimeSession): Record<string, unknown> {
  return {
    id: session.id, sessionId: session.id, kind: session.kind, provider: session.provider, status: session.status,
    missionId: session.missionId, taskId: session.taskId, limits: session.limits,
    metadata: {
      currentUrl: session.metadata['currentUrl'] ?? null, currentTitle: session.metadata['currentTitle'] ?? null,
      lastAction: session.metadata['lastAction'] ?? null, isolated: session.metadata['isolated'] ?? null,
      network: session.metadata['network'] ?? null, provider: session.metadata['provider'] ?? null,
      sandbox: session.metadata['sandbox'] ?? null,
    },
    createdAt: session.createdAt, startedAt: session.startedAt, endedAt: session.endedAt,
    expiresAt: new Date(session.expiresAt).toISOString(), error: session.error,
  };
}

async function ensureComputer(ctx: ToolContext, explicit?: string): Promise<RuntimeSession> {
  if (explicit) {
    const session = getComputerSession(ctx.workspaceId, explicit);
    if (!session) throw new Error('Cloud session not found in this workspace');
    assertRuntimeSessionAccess(ctx.workspaceId, session, principal(ctx));
    if (session.status !== 'running') throw new Error(`Cloud session is ${session.status}, not running`);
    return session;
  }
  return createComputerSession({ workspaceId: ctx.workspaceId, actor: principal(ctx), missionId: ctx.missionId, taskId: ctx.taskId });
}

async function ensureRuntimeSession(ctx: ToolContext, explicit?: string): Promise<RuntimeSession> {
  if (explicit) {
    const session = getRuntimeSession(ctx.workspaceId, explicit);
    if (!session) throw new Error('Runtime session not found in this workspace');
    assertRuntimeSessionAccess(ctx.workspaceId, session, principal(ctx));
    if (session.status !== 'running') throw new Error(`Runtime session is ${session.status}, not running`);
    return session;
  }
  return createComputerSession({ workspaceId: ctx.workspaceId, actor: principal(ctx), missionId: ctx.missionId, taskId: ctx.taskId });
}

async function ensureBrowser(ctx: ToolContext, explicit?: string): Promise<RuntimeSession> {
  if (explicit) {
    const session = getBrowserSession(ctx.workspaceId, explicit);
    if (!session) throw new Error('Browser session not found in this workspace');
    assertRuntimeSessionAccess(ctx.workspaceId, session, principal(ctx));
    if (session.status !== 'running') throw new Error(`Browser session is ${session.status}, not running`);
    return session;
  }
  const existing = listBrowserSessions(ctx.workspaceId, ctx.missionId, principal(ctx)).find((session) => session.status === 'running');
  if (existing) return existing;
  return createBrowserSession({ workspaceId: ctx.workspaceId, actor: principal(ctx), missionId: ctx.missionId, taskId: ctx.taskId });
}

const startSchema = z.object({ kind: z.enum(['computer', 'browser']).optional(), ttlMinutes: z.number().int().min(1).max(1440).optional(), allowNetwork: z.boolean().optional() }).strict();
const execSchema = z.object({ command: z.string().min(1).max(4000), sessionId: z.string().max(120).optional(), cwd: z.string().max(500).optional(), timeoutMs: z.number().int().min(1000).max(120000).optional() }).strict();
const writeSchema = z.object({ path: z.string().min(1).max(500), content: z.string().max(2_000_000), sessionId: z.string().max(120).optional() }).strict();
const readSchema = z.object({ path: z.string().min(1).max(500), sessionId: z.string().max(120).optional(), maxBytes: z.number().int().min(1).max(1_000_000).optional() }).strict();
const listSchema = z.object({ dir: z.string().max(500).optional(), sessionId: z.string().max(120).optional() }).strict();
const stopSchema = z.object({ sessionId: z.string().min(1).max(120), reason: z.string().max(500).optional() }).strict();
const openSchema = z.object({ url: z.string().url().max(2000), sessionId: z.string().max(120).optional() }).strict();
const browserSessionSchema = z.object({ sessionId: z.string().min(1).max(120) }).strict();
const clickSchema = z.object({ selector: z.string().max(500).optional(), text: z.string().max(300).optional(), sessionId: z.string().min(1).max(120) }).strict().refine((value) => Boolean(value.selector || value.text), 'selector or text is required');
const typeSchema = z.object({ selector: z.string().min(1).max(500), text: z.string().max(10_000), submit: z.boolean().optional(), sessionId: z.string().min(1).max(120) }).strict();
const selectSchema = z.object({ selector: z.string().min(1).max(500), value: z.string().min(1).max(500), sessionId: z.string().min(1).max(120) }).strict();
const scrollSchema = z.object({ delta: z.number().int().min(-10_000).max(10_000).optional(), sessionId: z.string().min(1).max(120) }).strict();
const waitSchema = z.object({ timeoutMs: z.number().int().min(100).max(30_000).optional(), sessionId: z.string().min(1).max(120) }).strict();
const screenshotSchema = z.object({ fullPage: z.boolean().optional(), name: z.string().max(200).optional(), sessionId: z.string().min(1).max(120) }).strict();
const researchSchema = z.object({ url: z.string().url().max(2000), filename: z.string().max(200).optional(), sessionId: z.string().max(120).optional() }).strict();

const startTool: ToolDefinition = {
  id: 'cloud.computer_start', name: 'Start Cloud Computer', description: 'Starts a real isolated cloud computer session using the configured runtime provider. Returns a session ID for shell and file tools.',
  inputSchema: { type: 'object', properties: { kind: { enum: ['computer', 'browser'] }, ttlMinutes: { type: 'number' }, allowNetwork: { type: 'boolean' } }, additionalProperties: false },
  schema: startSchema, permission: 'runtime:execute', risk: 'medium', environment: 'host', timeoutMs: 70_000,
  async execute(input: z.infer<typeof startSchema>, ctx) {
    if (input.allowNetwork === true) throw new Error('Cloud session network access is restricted to an explicit admin API request');
    if (input.kind === 'browser') return publicSession(await createBrowserSession({ workspaceId: ctx.workspaceId, actor: principal(ctx), missionId: ctx.missionId, taskId: ctx.taskId, ttlMinutes: input.ttlMinutes }));
    return publicSession(await createComputerSession({ workspaceId: ctx.workspaceId, actor: principal(ctx), missionId: ctx.missionId, taskId: ctx.taskId, ttlMinutes: input.ttlMinutes, allowNetwork: input.allowNetwork }));
  },
};

const execTool: ToolDefinition = {
  id: 'cloud.exec', name: 'Run Command in Cloud Computer', description: 'Runs a command inside a real cloud computer session. Docker sessions have no network by default and only the session workspace mounted; the process provider is explicitly non-isolated development fallback.',
  inputSchema: { type: 'object', properties: { command: { type: 'string' }, sessionId: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['command'], additionalProperties: false },
  schema: execSchema, permission: 'runtime:execute', risk: 'medium', environment: 'host', timeoutMs: 125_000,
  async execute(input: z.infer<typeof execSchema>, ctx) {
    const session = await ensureComputer(ctx, input.sessionId);
    const result = await execComputer({ workspaceId: ctx.workspaceId, actor: principal(ctx), sessionId: session.id, command: input.command, cwd: input.cwd, timeoutMs: input.timeoutMs });
    return { ...result, sessionId: session.id, provider: session.provider, isolated: session.provider === 'docker', stdout: redactSecrets(result.stdout).value, stderr: redactSecrets(result.stderr).value };
  },
};

const writeTool: ToolDefinition = {
  id: 'cloud.write_file', name: 'Write Cloud Workspace File', description: 'Writes a UTF-8 file inside the isolated cloud computer session workspace.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, sessionId: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
  schema: writeSchema, permission: 'runtime:write', risk: 'low', environment: 'host', timeoutMs: 10_000,
  async execute(input: z.infer<typeof writeSchema>, ctx) {
    const session = await ensureRuntimeSession(ctx, input.sessionId);
    const written = writeSessionFile({ workspaceId: ctx.workspaceId, sessionId: session.id, path: input.path, content: input.content, actor: principal(ctx) });
    const kind = input.path.endsWith('.md') ? 'markdown' : input.path.endsWith('.json') ? 'json' : 'file';
    const artifact = addRuntimeArtifact({ workspaceId: ctx.workspaceId, sessionId: session.id, missionId: ctx.missionId, name: path.basename(input.path), kind, mimeType: kind === 'markdown' ? 'text/markdown; charset=utf-8' : kind === 'json' ? 'application/json' : 'text/plain; charset=utf-8', storagePath: path.join(session.workspaceDir, input.path) });
    return { ...written, sessionId: session.id, artifactId: artifact.id, artifact: { id: artifact.id, name: artifact.name, kind: artifact.kind, sizeBytes: artifact.sizeBytes } };
  },
};

const readTool: ToolDefinition = {
  id: 'cloud.read_file', name: 'Read Cloud Workspace File', description: 'Reads a UTF-8 file inside a cloud computer session workspace.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' }, sessionId: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'], additionalProperties: false },
  schema: readSchema, permission: 'runtime:read', risk: 'low', environment: 'host', timeoutMs: 10_000,
  async execute(input: z.infer<typeof readSchema>, ctx) {
    const session = await ensureRuntimeSession(ctx, input.sessionId);
    return { ...readSessionFile({ workspaceId: ctx.workspaceId, sessionId: session.id, path: input.path, maxBytes: input.maxBytes, actor: principal(ctx) }), sessionId: session.id };
  },
};

const listTool: ToolDefinition = {
  id: 'cloud.list_files', name: 'List Cloud Workspace Files', description: 'Lists files and directories in a cloud computer session workspace.',
  inputSchema: { type: 'object', properties: { dir: { type: 'string' }, sessionId: { type: 'string' } }, additionalProperties: false },
  schema: listSchema, permission: 'runtime:read', risk: 'low', environment: 'host', timeoutMs: 10_000,
  async execute(input: z.infer<typeof listSchema>, ctx) {
    const session = await ensureRuntimeSession(ctx, input.sessionId);
    return { sessionId: session.id, dir: input.dir ?? '.', entries: listSessionFiles(ctx.workspaceId, session.id, input.dir ?? '.', principal(ctx)) };
  },
};

const stopTool: ToolDefinition = {
  id: 'cloud.computer_stop', name: 'Stop Cloud Computer', description: 'Stops a cloud computer session and releases its container resources. History and artifacts remain available.',
  inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, reason: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: stopSchema, permission: 'runtime:execute', risk: 'low', environment: 'host', timeoutMs: 30_000,
  async execute(input: z.infer<typeof stopSchema>, ctx) {
    return publicSession(await stopComputerSession({ workspaceId: ctx.workspaceId, sessionId: input.sessionId, actor: principal(ctx), reason: input.reason }));
  },
};

const openTool: ToolDefinition = {
  id: 'browser.open', name: 'Open Browser Page', description: 'Opens an authorized http(s) URL in a real Chromium child process and returns the actual title, URL, navigation, headings and visible text.',
  inputSchema: { type: 'object', properties: { url: { type: 'string' }, sessionId: { type: 'string' } }, required: ['url'], additionalProperties: false },
  schema: openSchema, permission: 'browser:read', risk: 'medium', environment: 'host', timeoutMs: 55_000,
  async execute(input: z.infer<typeof openSchema>, ctx) {
    assertSafeOutboundUrl(input.url);
    const session = await ensureBrowser(ctx, input.sessionId);
    return { ...(await browserOpen(ctx.workspaceId, session.id, input.url, principal(ctx))), sessionId: session.id };
  },
};

const inspectTool: ToolDefinition = {
  id: 'browser.inspect', name: 'Inspect Browser Page', description: 'Reads the current page title, URL, navigation links, headings and visible text from an existing browser session.',
  inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: browserSessionSchema, permission: 'browser:read', risk: 'low', environment: 'host', timeoutMs: 30_000,
  async execute(input: z.infer<typeof browserSessionSchema>, ctx) {
    return { ...(await browserInspect(ctx.workspaceId, input.sessionId, principal(ctx))), sessionId: input.sessionId };
  },
};

const clickTool: ToolDefinition = {
  id: 'browser.click', name: 'Click Browser Element', description: 'Clicks a selector or visible text in an existing browser session. Financial/checkout-like elements are refused and require the approved financial workflow.',
  inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' }, sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: clickSchema, permission: 'browser:interact', risk: 'medium', environment: 'host', timeoutMs: 40_000,
  riskForInput: (input) => { const intent = financialIntent('click', (input ?? {}) as Record<string, unknown>); return intent.required ? { risk: 'high', spendsMoney: true, ...(intent.amountUsd !== undefined ? { amountUsd: intent.amountUsd } : {}), reason: intent.reason } : { risk: 'medium' }; },
  async execute(input: z.infer<typeof clickSchema>, ctx) {
    return { ...(await browserClick(ctx.workspaceId, input.sessionId, { selector: input.selector, text: input.text }, principal(ctx), ctx.financialApproved === true)), sessionId: input.sessionId };
  },
};

const typeTool: ToolDefinition = {
  id: 'browser.type', name: 'Type in Browser Field', description: 'Fills a form field in an existing browser session; optionally submits with Enter.',
  inputSchema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' }, sessionId: { type: 'string' } }, required: ['selector', 'text', 'sessionId'], additionalProperties: false },
  schema: typeSchema, permission: 'browser:interact', risk: 'medium', environment: 'host', timeoutMs: 40_000,
  riskForInput: (input) => { const intent = financialIntent('type', (input ?? {}) as Record<string, unknown>); return intent.required ? { risk: 'high', spendsMoney: true, ...(intent.amountUsd !== undefined ? { amountUsd: intent.amountUsd } : {}), reason: intent.reason } : { risk: 'medium' }; },
  async execute(input: z.infer<typeof typeSchema>, ctx) {
    return { ...(await browserType(ctx.workspaceId, input.sessionId, { selector: input.selector, text: input.text, submit: input.submit }, principal(ctx), ctx.financialApproved === true)), sessionId: input.sessionId };
  },
};

const selectTool: ToolDefinition = {
  id: 'browser.select', name: 'Select Browser Option', description: 'Selects an option in a select element in an existing browser session.',
  inputSchema: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' }, sessionId: { type: 'string' } }, required: ['selector', 'value', 'sessionId'], additionalProperties: false },
  schema: selectSchema, permission: 'browser:interact', risk: 'medium', environment: 'host', timeoutMs: 30_000,
  riskForInput: (input) => { const intent = financialIntent('select', (input ?? {}) as Record<string, unknown>); return intent.required ? { risk: 'high', spendsMoney: true, ...(intent.amountUsd !== undefined ? { amountUsd: intent.amountUsd } : {}), reason: intent.reason } : { risk: 'medium' }; },
  async execute(input: z.infer<typeof selectSchema>, ctx) {
    return { ...(await browserSelect(ctx.workspaceId, input.sessionId, { selector: input.selector, value: input.value }, principal(ctx), ctx.financialApproved === true)), sessionId: input.sessionId };
  },
};

const scrollTool: ToolDefinition = {
  id: 'browser.scroll', name: 'Scroll Browser Page', description: 'Scrolls the current page by a pixel delta in an existing browser session.',
  inputSchema: { type: 'object', properties: { delta: { type: 'number' }, sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: scrollSchema, permission: 'browser:interact', risk: 'low', environment: 'host', timeoutMs: 30_000,
  async execute(input: z.infer<typeof scrollSchema>, ctx) {
    return { ...(await browserScroll(ctx.workspaceId, input.sessionId, input.delta, principal(ctx))), sessionId: input.sessionId };
  },
};

const waitTool: ToolDefinition = {
  id: 'browser.wait', name: 'Wait in Browser', description: 'Waits for a bounded duration in an existing browser session.',
  inputSchema: { type: 'object', properties: { timeoutMs: { type: 'number' }, sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: waitSchema, permission: 'browser:read', risk: 'low', environment: 'host', timeoutMs: 40_000,
  async execute(input: z.infer<typeof waitSchema>, ctx) {
    return { ...(await browserWait(ctx.workspaceId, input.sessionId, input.timeoutMs, principal(ctx))), sessionId: input.sessionId };
  },
};

const screenshotTool: ToolDefinition = {
  id: 'browser.screenshot', name: 'Capture Browser Screenshot', description: 'Captures a real PNG screenshot from an existing browser session and records it as a downloadable runtime artifact. Password inputs are masked.',
  inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' }, name: { type: 'string' }, sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: screenshotSchema, permission: 'browser:read', risk: 'low', environment: 'host', timeoutMs: 40_000,
  async execute(input: z.infer<typeof screenshotSchema>, ctx) {
    return { ...(await browserScreenshot(ctx.workspaceId, input.sessionId, { fullPage: input.fullPage, name: input.name }, principal(ctx))), sessionId: input.sessionId };
  },
};

const researchTool: ToolDefinition = {
  id: 'browser.research', name: 'Research Public Page with Browser', description: 'Opens a public http(s) page in a real browser, inspects navigation/content, captures a screenshot and writes a Markdown summary inside the browser workspace. Returns artifact IDs for the document and screenshot.',
  inputSchema: { type: 'object', properties: { url: { type: 'string' }, filename: { type: 'string' }, sessionId: { type: 'string' } }, required: ['url'], additionalProperties: false },
  schema: researchSchema, permission: 'browser:interact', risk: 'medium', environment: 'host', timeoutMs: 90_000,
  async execute(input: z.infer<typeof researchSchema>, ctx) {
    assertSafeOutboundUrl(input.url);
    const session = await ensureBrowser(ctx, input.sessionId);
    const result = await browserResearch(ctx.workspaceId, session.id, { url: input.url, filename: input.filename }, principal(ctx));
    audit(getOsDb(), { workspaceId: ctx.workspaceId, actor: ctx.actor, action: 'runtime.browser.research', subject: session.id, detail: { url: input.url, title: result['title'], documentArtifactId: result['documentArtifactId'] } });
    return { ...result, sessionId: session.id };
  },
};

const closeTool: ToolDefinition = {
  id: 'browser.close', name: 'Close Browser Session', description: 'Closes the Chromium child process and marks the browser session stopped. Artifacts remain downloadable.',
  inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, reason: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  schema: stopSchema, permission: 'browser:read', risk: 'low', environment: 'host', timeoutMs: 30_000,
  async execute(input: z.infer<typeof stopSchema>, ctx) {
    return publicSession(await closeBrowserSession({ workspaceId: ctx.workspaceId, sessionId: input.sessionId, actor: principal(ctx), reason: input.reason }));
  },
};

export const RUNTIME_TOOLS: ToolDefinition[] = [
  startTool, execTool, writeTool, readTool, listTool, stopTool,
  openTool, inspectTool, clickTool, typeTool, selectTool, scrollTool, waitTool, screenshotTool, researchTool, closeTool,
];

export function runtimeSessionsForWorkspace(workspaceId: string, missionId: string | undefined, actor: string) {
  return {
    computer: listComputerSessions(workspaceId, { missionId, actor }).map(publicSession),
    browser: listBrowserSessions(workspaceId, missionId, actor).map(publicSession),
  };
}

export function runtimeArtifactsForWorkspace(workspaceId: string, missionId: string | undefined, actor: string) {
  return listRuntimeArtifacts(workspaceId, { missionId, actor }).map((artifact) => ({ ...artifact, contentUrl: `/api/os/runtime/artifacts/${artifact.id}` }));
}
