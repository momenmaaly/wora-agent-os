import { readSessionToken } from '../lib/session.js';
import { MAX_DRAFT_MONEY, type StudioBrief, type StudioDraft, type StudioPack } from './drafts.js';

export type StudioMode = { mode: 'live' } | { mode: 'template'; reason: 'unconfigured' | 'sign-in' | 'offline' };

export class StudioRequestError extends Error {
  constructor(readonly code: string) { super(code); }
}

function request(path: 'status' | 'drafts', init: RequestInit) {
  const configured = import.meta.env.VITE_API_URL?.trim();
  const url = new URL(`/api/studio/${path}`, configured || window.location.origin);
  const token = readSessionToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers, cache: 'no-store', redirect: 'error' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && Boolean(value.trim()) && value.length <= max; }
function money(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DRAFT_MONEY; }
function draft(value: unknown): value is StudioDraft {
  return isRecord(value) && text(value.name, 100) && text(value.description, 420) && text(value.category, 60) && money(value.price) && money(value.cost);
}
function isPack(value: unknown): value is StudioPack {
  return isRecord(value) && text(value.title, 90) && text(value.summary, 300)
    && Array.isArray(value.drafts) && value.drafts.length === 3 && value.drafts.every(draft)
    && isRecord(value.launch) && text(value.launch.tagline, 120)
    && Array.isArray(value.launch.actions) && value.launch.actions.length === 3 && value.launch.actions.every((action) => text(action, 180));
}

export async function getStudioMode(signal: AbortSignal): Promise<StudioMode> {
  try {
    const response = await request('status', { signal });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return { mode: 'template', reason: 'offline' };
    const status: unknown = await response.json();
    if (!isRecord(status) || (status.mode !== 'live' && status.mode !== 'template')) return { mode: 'template', reason: 'offline' };
    if (status.mode === 'live') return { mode: 'live' };
    return { mode: 'template', reason: status.reason === 'sign-in' ? 'sign-in' : 'unconfigured' };
  } catch { return { mode: 'template', reason: 'offline' }; }
}

export async function requestStudioPack(brief: StudioBrief, signal: AbortSignal): Promise<StudioPack> {
  const response = await request('drafts', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new StudioRequestError(isRecord(body) && typeof body.code === 'string' ? body.code : 'REQUEST_FAILED');
  }
  if (!isRecord(body) || !isPack(body.pack)) throw new StudioRequestError('INVALID_RESPONSE');
  return body.pack;
}
