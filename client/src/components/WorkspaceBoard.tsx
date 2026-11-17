import { useMemo, useState } from 'react';
import { Check, ClipboardList, Clock3, LockKeyhole, MapPin, Plus } from 'lucide-react';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { useWoraStore, workspaceEntryLabel } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { OFFICE_ROOMS, ROOM_BY_ID } from '../office/layout.js';
import { orderedAgents } from '../office/presentation.js';
import { Dialog, EmptyState } from './ui.js';

const statusText: Record<string, string> = { open: 'مفتوحة', in_progress: 'قيد التنفيذ', approved: 'معتمدة', done: 'مكتملة', rejected: 'مرفوضة' };
const typeText: Record<string, string> = { task: 'مهمة', artifact: 'مخرج', review: 'مراجعة', handoff: 'تسليم', signal: 'مهمة' };

function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const workspaces = useWoraStore((s) => s.workspaces);
  const agents = useWoraStore((s) => s.agents);
  const connected = useWoraStore((s) => s.connected);
  const zones = useWoraStore((s) => s.zones);
  const { sendWorkspaceSignal } = useSocket();
  const assignees = useMemo(() => orderedAgents(agents), [agents]);
  const plan = useBillingStore((s) => s.plan);
  const [zoneId, setZone] = useState(() => useWoraStore.getState().ui.workspaceZoneId ?? 'zone-planning');
  const locked = isRoomLockedForPlan(zoneId, plan);
  const [assigneeId, setAssignee] = useState(() => useWoraStore.getState().selectedAgentId ?? '');
  const [title, setTitle] = useState('');
  const assignee = agents[assigneeId] ?? assignees[0];
  const zone = ROOM_BY_ID[zoneId];
  const entries = workspaces[zoneId]?.entries ?? [];
  const sorted = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const local = !connected || !zones.some((item) => item.id === zoneId) || assignee?.id.startsWith('agent-custom-');

  return <Dialog icon={ClipboardList} title="مهام الأقسام" description="راجع المهام وأرسل الوكيل المسؤول إلى القسم المناسب." variant="drawer" onClose={onClose}>
    <div className="field-stack">
      <label className="label"><span className="label-icon"><MapPin size={15} />القسم</span><select className="field" value={zoneId} onChange={(event) => setZone(event.target.value)}>
        {OFFICE_ROOMS.filter((room) => room.isBackendZone).map((room) => (
          <option key={room.id} value={room.id}>{room.nameAr} ({workspaces[room.id]?.entries.length ?? 0})</option>
        ))}
      </select></label>
      <form className="task-composer field-stack" onSubmit={(event) => {
        event.preventDefault();
        if (!locked && assignee && sendWorkspaceSignal(zoneId, assignee.id, title, { source: 'hq-board' })) setTitle('');
      }}>
        <label className="label">مهمة جديدة<input className="field" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: تجهيز خطة الأسبوع القادم" dir="auto" /></label>
        <div className="task-composer-actions">
          <label className="label">الوكيل المسؤول<select className="field" value={assignee?.id ?? ''} onChange={(event) => setAssignee(event.target.value)}>
            {!assignees.length && <option value="">لا يوجد وكلاء متاحون</option>}
            {assignees.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
          </select></label>
          <button className="button primary" type="submit" disabled={!title.trim() || !assignee || locked}><Plus size={17} />إضافة مهمة</button>
        </div>
        <p className="field-note">{locked ? <><LockKeyhole size={14} className="inline-icon" />إضافة مهام لهذا القسم متاحة في خطة Pro.</> : local ? 'هذه المهمة محلية ومتاحة خلال الجلسة الحالية فقط.' : 'ستظهر المهمة في لوحة القسم بعد إضافتها.'}</p>
      </form>
      <section className="task-entries" aria-label="المهام المسجلة">
        <h3>المهام المسجلة <span className="badge">{entries.length}</span></h3>
        {sorted.length ? <ul>{sorted.map((entry) => {
          const source = workspaceEntryLabel(entry.id);
          const done = entry.status === 'approved' || entry.status === 'done';
          return <li key={entry.id} className="task-entry">
            <div><strong dir="auto">{entry.title}</strong><span className="badge">{typeText[entry.type] ?? entry.type}</span></div>
            <div><span className={`badge tint ${done ? 'tone-mint' : 'tone-gold'}`}>{done ? <Check size={13} /> : <Clock3 size={13} />}{statusText[entry.status] ?? entry.status}</span><small>{[agents[entry.authorAgentId]?.displayName, source].filter(Boolean).join(' · ') || 'وكيل القسم'}</small></div>
          </li>;
        })}</ul> : <EmptyState icon={ClipboardList} title="لا توجد مهام هنا بعد">أضف أول مهمة في {zone?.nameAr ?? 'هذا القسم'}.</EmptyState>}
      </section>
    </div>
  </Dialog>;
}

export function WorkspaceBoard() {
  const open = useWoraStore((s) => s.ui.showWorkspaceHUD);
  const toggle = useWoraStore((s) => s.toggleWorkspaceHUD);
  return open ? <WorkspacePanel onClose={() => toggle(false)} /> : null;
}
