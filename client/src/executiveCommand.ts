export const EXECUTIVE_COMMAND_EVENT = 'wora:executive-command';
const PENDING_KEY = 'wora.pendingExecutiveCommand';
const MAX_LENGTH = 1200;

/** Queues a real owner instruction for the existing Manager Office composer. */
export function queueExecutiveCommand(text: string): string {
  const brief = text.trim().slice(0, MAX_LENGTH);
  if (!brief) return '';
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.setItem(PENDING_KEY, brief); } catch { /* storage may be unavailable */ }
    try { window.dispatchEvent(new CustomEvent<string>(EXECUTIVE_COMMAND_EVENT, { detail: brief })); } catch { /* older browsers */ }
  }
  return brief;
}

export function takeExecutiveCommand(): string {
  if (typeof window === 'undefined') return '';
  try {
    const value = window.sessionStorage.getItem(PENDING_KEY)?.trim() ?? '';
    window.sessionStorage.removeItem(PENDING_KEY);
    return value.slice(0, MAX_LENGTH);
  } catch {
    return '';
  }
}
