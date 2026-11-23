/**
 * WORA OS — Project OS board sync.
 *
 * The zustand Project OS store stays optimistic + localStorage-fast; this module
 * makes the same state durable on the server (os_boards, per workspace):
 *  - initBoardSync(): pull once on boot — server wins when a board exists;
 *    otherwise push the local document up (first-device seeding).
 *  - every store mutation triggers a debounced PUT (board.change events).
 *  - sync status is exposed via useBoardSync for UI indicators and error surfaces.
 * Sync failures never wipe local state; they are surfaced, not swallowed.
 */
import { create } from 'zustand';
import { osApi } from '../os/api.js';
import { useProjectStore } from './useProjectStore.js';

interface BoardSyncState {
  status: 'idle' | 'loading' | 'synced' | 'saving' | 'error';
  lastSyncedAt: string | null;
  error: string | null;
  serverBacked: boolean;
}

export const useBoardSync = create<BoardSyncState>(() => ({ status: 'idle', lastSyncedAt: null, error: null, serverBacked: false }));

const partialize = (s: ReturnType<typeof useProjectStore.getState>) => ({
  projects: s.projects, activeProjectId: s.activeProjectId,
  products: s.products, ideas: s.ideas, tasks: s.tasks,
});

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

async function pull(): Promise<void> {
  useBoardSync.setState({ status: 'loading' });
  try {
    const remote = await osApi.board();
    if (remote.state && Array.isArray((remote.state as { projects?: unknown }).projects)) {
      const state = remote.state as Record<string, unknown>;
      useProjectStore.setState({
        projects: (state['projects'] as never) ?? [],
        activeProjectId: (state['activeProjectId'] as string | null) ?? null,
        products: (state['products'] as never) ?? [],
        ideas: (state['ideas'] as never) ?? [],
        tasks: (state['tasks'] as never) ?? [],
        isDemo: false,
      });
      useBoardSync.setState({ status: 'synced', lastSyncedAt: remote.updatedAt, error: null, serverBacked: true });
      return;
    }
    // No remote board yet — seed it from local state (first device wins).
    const saved = await osApi.saveBoard(partialize(useProjectStore.getState()));
    useBoardSync.setState({ status: 'synced', lastSyncedAt: saved.updatedAt, error: null, serverBacked: true });
  } catch (err) {
    useBoardSync.setState({ status: 'error', error: err instanceof Error ? err.message : 'تعذر الاتصال بخادم اللوحة', serverBacked: false });
  }
}

async function push(): Promise<void> {
  useBoardSync.setState({ status: 'saving' });
  try {
    const saved = await osApi.saveBoard(partialize(useProjectStore.getState()));
    useBoardSync.setState({ status: 'synced', lastSyncedAt: saved.updatedAt, error: null, serverBacked: true });
  } catch (err) {
    useBoardSync.setState({ status: 'error', error: err instanceof Error ? err.message : 'تعذر حفظ اللوحة', serverBacked: false });
  }
}

export function initBoardSync(): void {
  if (started) return;
  started = true;
  void pull();
  useProjectStore.subscribe((state, prev) => {
    if (state === prev) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { void push(); }, 800);
  });
}

export async function resetBoardToEmpty(): Promise<void> {
  useProjectStore.setState({ projects: [], activeProjectId: null, products: [], ideas: [], tasks: [], isDemo: false });
  try {
    await osApi.clearBoard();
    useBoardSync.setState({ status: 'synced', lastSyncedAt: new Date().toISOString(), error: null, serverBacked: true });
  } catch (err) {
    useBoardSync.setState({ status: 'error', error: err instanceof Error ? err.message : 'تعذر مسح اللوحة على الخادم' });
  }
}
