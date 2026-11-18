import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudioBrief, StudioDraft, StudioPack, StudioSource } from './drafts.js';

export const STUDIO_HISTORY_LIMIT = 10;
export const EMPTY_BRIEF: StudioBrief = { idea: '', audience: '', positioning: 'balanced' };

export type StudioSession = {
  id: string;
  createdAt: string;
  source: StudioSource;
  brief: StudioBrief;
  pack: StudioPack;
};

interface StudioState {
  brief: StudioBrief;
  sessions: StudioSession[];
  activeId: string | null;
  setBrief: (brief: Partial<StudioBrief>) => void;
  addSession: (brief: StudioBrief, pack: StudioPack, source: StudioSource) => void;
  selectSession: (id: string | null) => void;
  deleteSession: (id: string) => void;
  editDraft: (sessionId: string, index: number, draft: StudioDraft) => void;
}

export const useStudioStore = create<StudioState>()(persist((set) => ({
  brief: EMPTY_BRIEF,
  sessions: [],
  activeId: null,
  setBrief: (patch) => set((state) => ({ brief: { ...state.brief, ...patch } })),
  addSession: (brief, pack, source) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result: StudioSession = { id, createdAt: new Date().toISOString(), brief, pack, source };
    set((state) => ({ activeId: id, sessions: [result, ...state.sessions].slice(0, STUDIO_HISTORY_LIMIT) }));
  },
  selectSession: (activeId) => set({ activeId }),
  deleteSession: (id) => set((state) => {
    const sessions = state.sessions.filter((session) => session.id !== id);
    return { sessions, activeId: state.activeId === id ? sessions[0]?.id ?? null : state.activeId };
  }),
  editDraft: (id, index, draft) => set((state) => ({ sessions: state.sessions.map((session) => session.id !== id ? session : {
    ...session, pack: { ...session.pack, drafts: session.pack.drafts.map((item, i) => i === index ? draft : item) },
  }) })),
}), { name: 'wora:studio:v1', partialize: ({ brief, sessions, activeId }) => ({ brief, sessions, activeId }) }));
