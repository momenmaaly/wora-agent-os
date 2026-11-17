import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IntegrationId } from '../integrations/catalog.js';

export interface ConnectedIntegration {
  id: IntegrationId;
  connectedAt: string;
  accountLabel?: string; // e.g. "momen@github"
  status: 'connected'|'error'|'syncing';
  lastSyncAt?: string;
}

interface IntegrationsState {
  connections: Record<string, ConnectedIntegration>;
  connect: (id: IntegrationId, label?: string)=>void;
  disconnect: (id: IntegrationId)=>void;
  isConnected: (id: IntegrationId)=>boolean;
  sync: (id: IntegrationId)=>void;
}

export const useIntegrationsStore = create<IntegrationsState>()(persist((set,get)=>({
  connections:{},
  connect:(id,label)=> set(s=>({
    connections:{ ...s.connections, [id]: { id, connectedAt:new Date().toISOString(), accountLabel: label ?? 'متصل', status:'connected', lastSyncAt:new Date().toISOString() } }
  })),
  disconnect:(id)=> set(s=>{ const n={...s.connections}; delete n[id]; return { connections:n }; }),
  isConnected:(id)=> !!get().connections[id],
  sync:(id)=> set(s=> s.connections[id] ? { connections:{ ...s.connections, [id]:{...s.connections[id]!, status:'connected', lastSyncAt:new Date().toISOString() } } } : s),
}),{ name:'wora:integrations:v1', partialize:s=>({ connections:s.connections })}));
