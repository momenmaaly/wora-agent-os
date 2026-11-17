import { useState } from 'react';
import { Check, Cpu } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { BRAIN_MODELS, BRAIN_PROVIDER_LABELS, BrainProvider, type AgentParticipant } from '../types.js';
import { AgentAvatar } from './Dashboard.js';
import { Dialog, Notice } from './ui.js';

function SwapForm({ agent, onClose }: { agent: AgentParticipant; onClose: () => void }) {
  const { swapBrain } = useSocket();
  const config = agent.brainConfig;
  const [provider, setProvider] = useState<BrainProvider>(() => config && BRAIN_MODELS[config.provider] ? config.provider : BrainProvider.Google);
  const [model, setModel] = useState(() => config && BRAIN_MODELS[config.provider]?.includes(config.model) ? config.model : BRAIN_MODELS[provider][0]!);
  const unchanged = provider === config?.provider && model === config?.model;
  return <Dialog icon={Cpu} title="تبديل نموذج الوكيل" onClose={onClose}
    footer={<><button type="button" className="button ghost" onClick={onClose}>إلغاء</button><button type="submit" form="swap-model" className="button primary" disabled={unchanged}><Check size={16} />تأكيد التبديل</button></>}>
    <form id="swap-model" className="field-stack" onSubmit={(event) => { event.preventDefault(); if (!unchanged && swapBrain(agent.id, { provider, model })) onClose(); }}>
      <div className="swap-summary"><AgentAvatar agent={agent} /><div><strong><bdi>{agent.displayName}</bdi></strong><small>{agent.profile.customRole}</small></div><span className="badge mono"><bdi>{config?.model ?? agent.modelId}</bdi></span></div>
      <label className="label">المزوّد الجديد<select className="field" value={provider} onChange={(event) => {
        const next = event.target.value as BrainProvider;
        setProvider(next); setModel(BRAIN_MODELS[next][0]!);
      }}>{Object.entries(BRAIN_PROVIDER_LABELS).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label className="label">النموذج الجديد<select className="field" dir="ltr" value={model} onChange={(event) => setModel(event.target.value)}>{BRAIN_MODELS[provider].map((id) => <option key={id}>{id}</option>)}</select></label>
      <Notice>يحدّث هذا الاختيار إعدادات الوكيل. تشغيل النموذج فعلياً يتطلب إعداد المزوّد على الخادم.</Notice>
    </form>
  </Dialog>;
}

export function ModelSwapModal() {
  const agent = useWoraStore((s) => s.ui.modelSwapAgentId ? s.agents[s.ui.modelSwapAgentId] : undefined);
  const open = useWoraStore((s) => s.openModelSwap);
  return agent ? <SwapForm key={agent.id} agent={agent} onClose={() => open(null)} /> : null;
}
