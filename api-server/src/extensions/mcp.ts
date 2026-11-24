/**
 * WORA extensions — MCP client (JSON-RPC 2.0 over stdio and HTTP).
 *
 * A stdio MCP server runs as a separate child process, never inside the API
 * process. It receives only the secrets its manifest declares (plus a minimal
 * PATH/HOME/LANG), one session per operation, and is terminated when the call
 * finishes. HTTP MCP servers are called with a hard deadline and no redirects.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeFetch } from '../lib/safe-fetch.js';

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpOptions {
  transport: 'stdio' | 'http';
  command?: string | null;
  args?: string[];
  url?: string | null;
  env?: Record<string, string>;
  timeoutMs?: number;
  trust?: 'official' | 'verified' | 'community' | 'untrusted';
  signal?: AbortSignal;
}

export class McpError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'McpError';
  }
}

const MAX_MESSAGE_BYTES = 1_000_000;
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | null = null;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new McpError('MCP_TIMEOUT', `${label} timed out after ${milliseconds}ms`)), milliseconds);
      if (signal) {
        if (signal.aborted) reject(new McpError('MCP_ABORTED', `${label} was aborted`));
        else {
          abortListener = () => reject(new McpError('MCP_ABORTED', `${label} was aborted`));
          signal.addEventListener('abort', abortListener, { once: true });
        }
      }
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  });
}

/**
 * Stdio MCP is trusted-code only until a verified sandbox runner exists.
 * `official` allows the bundled WORA catalog; community code is never spawned
 * on the API host. Set this explicitly in a test environment when exercising
 * the bundled echo server; production defaults to `disabled`.
 */
function stdioMode(): 'disabled' | 'official' {
  return process.env['WORA_MCP_STDIO_MODE']?.trim().toLowerCase() === 'official' ? 'official' : 'disabled';
}

export class McpSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private home: string | null = null;
  private sessionId: string | null = null;
  private closed = false;
  private abortListener: (() => void) | null = null;

  private constructor(private readonly options: McpOptions) {}

  static async open(options: McpOptions): Promise<McpSession> {
    if (options.signal?.aborted) throw new McpError('MCP_ABORTED', 'MCP session was aborted before start');
    const session = new McpSession(options);
    if (options.signal) {
      session.abortListener = () => session.close();
      options.signal.addEventListener('abort', session.abortListener, { once: true });
    }
    try {
      if (options.transport === 'stdio') session.startStdio();
      await session.initialize();
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  private startStdio(): void {
    const command = this.options.command ?? '';
    if (stdioMode() !== 'official') throw new McpError('MCP_STDIO_DISABLED', 'Stdio MCP execution is disabled; no verified sandbox runner is configured');
    if (this.options.trust !== 'official') throw new McpError('MCP_STDIO_UNTRUSTED', 'Only official bundled MCP servers may run as stdio on the API host');
    if (!/^(?:node|npx|python3|uvx|deno)$/u.test(command)) throw new McpError('MCP_COMMAND_DENIED', 'MCP command is not allowed');
    this.home = mkdtempSync(path.join(os.tmpdir(), 'wora-mcp-home-'));
    const env: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: this.home,
      TMPDIR: os.tmpdir(),
      LANG: process.env['LANG'] ?? 'C.UTF-8',
      ...(this.options.env ?? {}),
    };
    this.child = spawn(command, this.options.args ?? [], {
      cwd: this.home,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding('utf8');
    // Drain stderr without storing it: it can echo secrets.
    this.child.stderr.on('data', () => { /* intentionally discarded */ });
    this.child.on('exit', () => this.failAll(new McpError('MCP_EXITED', 'MCP server process exited')));
    this.child.on('error', () => this.failAll(new McpError('MCP_START_FAILED', 'MCP server process could not be started')));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_MESSAGE_BYTES) {
      this.buffer = '';
      this.failAll(new McpError('MCP_MESSAGE_TOO_LARGE', 'MCP server produced an oversized message'));
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try { message = JSON.parse(line) as JsonRpcResponse; } catch { return; }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new McpError('MCP_ERROR', (message.error.message ?? 'MCP error').slice(0, 500)));
    else pending.resolve(message.result);
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'wora-extensions', version: '4.1.0' },
    });
    if (this.options.transport === 'stdio') this.notify('notifications/initialized', {});
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) return;
    try { this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); } catch { /* stream closed */ }
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const timeout = this.options.timeoutMs ?? 12_000;
    if (this.options.transport === 'stdio') {
      if (!this.child || this.closed) throw new McpError('MCP_CLOSED', 'MCP session is closed');
      const id = this.nextId++;
      const response = new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
      });
      try {
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        this.pending.delete(id);
        throw new McpError('MCP_WRITE_FAILED', 'Could not write to the MCP server');
      }
      return withDeadline(response, timeout, method);
    }
    if (!this.options.url) throw new McpError('MCP_NO_URL', 'HTTP MCP server has no URL');
    const id = this.nextId++;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const token = this.options.env?.['MCP_HTTP_TOKEN'];
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const url = new URL(this.options.url);
    const result = await withDeadline(safeFetch(this.options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      timeoutMs: timeout,
      maxBytes: MAX_MESSAGE_BYTES,
      allowRedirects: false,
      allowedPorts: new Set(['', url.port, url.port || (url.protocol === 'https:' ? '443' : '80')]),
      signal: this.options.signal,
    }), timeout + 500, method, this.options.signal);
    const sessionHeader = result.headers['mcp-session-id'];
    if (typeof sessionHeader === 'string') this.sessionId = sessionHeader;
    if (result.status < 200 || result.status >= 300) {
      throw new McpError('MCP_HTTP_ERROR', `MCP server responded with HTTP ${result.status}`);
    }
    const contentType = result.contentType;
    const text = result.body.toString('utf8');
    if (text.length > MAX_MESSAGE_BYTES) throw new McpError('MCP_MESSAGE_TOO_LARGE', 'MCP server produced an oversized response');
    const payload = contentType.includes('text/event-stream')
      ? text.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean)
        .map((data) => { try { return JSON.parse(data) as JsonRpcResponse; } catch { return null; } })
        .find((message): message is JsonRpcResponse => Boolean(message && message.id === id))
      : (() => { try { return JSON.parse(text) as JsonRpcResponse; } catch { return null; } })();
    if (!payload) throw new McpError('MCP_INVALID_RESPONSE', 'MCP server returned an unreadable response');
    if (payload.error) throw new McpError('MCP_ERROR', (payload.error.message ?? 'MCP error').slice(0, 500));
    return payload.result;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.request('tools/list', {}) as { tools?: unknown } | null;
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.slice(0, 200).map((raw) => {
      const tool = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };
      return {
        name: typeof tool.name === 'string' ? tool.name.slice(0, 120) : '',
        description: typeof tool.description === 'string' ? tool.description.slice(0, 1_000) : '',
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
          ? tool.inputSchema as Record<string, unknown> : { type: 'object', properties: {} },
      };
    }).filter((tool) => tool.name);
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args ?? {} });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.abortListener && this.options.signal) this.options.signal.removeEventListener('abort', this.abortListener);
    this.abortListener = null;
    this.failAll(new McpError('MCP_CLOSED', 'MCP session closed'));
    const child = this.child;
    this.child = null;
    if (child) {
      try { child.stdin.end(); } catch { /* already closed */ }
      const signalGroup = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch { /* already exited */ }
      };
      signalGroup('SIGTERM');
      const timer = setTimeout(() => signalGroup('SIGKILL'), 1_000);
      timer.unref?.();
    }
    if (this.home) {
      const home = this.home;
      this.home = null;
      try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

export async function probeMcp(options: McpOptions): Promise<{ ok: boolean; tools: McpToolDescriptor[]; latencyMs: number; error: string | null }> {
  const started = Date.now();
  let session: McpSession | null = null;
  try {
    session = await McpSession.open(options);
    const tools = await session.listTools();
    return { ok: true, tools, latencyMs: Date.now() - started, error: null };
  } catch (error) {
    return { ok: false, tools: [], latencyMs: Date.now() - started, error: error instanceof Error ? error.message.slice(0, 300) : 'MCP probe failed' };
  } finally {
    session?.close();
  }
}

export async function callMcpTool(options: McpOptions, toolName: string, args: unknown): Promise<unknown> {
  const session = await McpSession.open(options);
  try {
    return await session.callTool(toolName, args);
  } finally {
    session.close();
  }
}
