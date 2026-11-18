import { useMemo, useRef, useState } from 'react';
import { Check, ClipboardList, Clock3, LockKeyhole, Radio, Plus } from 'lucide-react';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { CHANNELS, CHANNEL_BY_ID } from '../office/channels.js';
import { orderedAgents, ROOM_DISPLAY } from '../office/presentation.js';
import { canTakeTask, isFinished, isRecorded, taskExecutionNote, taskSourceLabel, taskStage } from '../office/work.js';
import { Dialog, EmptyState } from './ui.js';

function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const workspaces = useWoraStore((s) => s.workspaces);
  const agents = useWoraStore((s) => s.agents);
  const connected = useWoraStore((s) => s.connected);
  const zones = useWoraStore((s) => s.zones);
  const { sendWorkspaceSignal } = useSocket();
  const assignees = useMemo(() => orderedAgents(agents).filter(canTakeTask), [agents]);
  const plan = useBillingStore((s) => s.plan);
  const focusedId = useWoraStore((s) => s.ui.workspaceEntryId);
  const [zoneId, setZone] = useState(() => useWoraStore.getState().ui.workspaceZoneId ?? '');
  const [assigneeId, setAssignee] = useState(() => useWoraStore.getState().selectedAgentId ?? '');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ongoing = useRef(false);
  const locked = isRoomLockedForPlan(zoneId, plan);
  const assignee = assignees.find((agent) => agent.id === assigneeId) ?? assignees.find((agent) => agent.zoneId === zoneId) ?? assignees[0];
  const now = Date.now();
  const entries = (zoneId ? workspaces[zoneId]?.entries ?? [] : Object.values(workspaces).flatMap((workspace) => workspace.entries)).filter((entry) => isRecorded(entry, now));
  const sorted = [...entries].sort((a, b) => Number(b.id === focusedId) - Number(a.id === focusedId) || b.updatedAt.localeCompare(a.updatedAt));
  const local = !connected || !zones.some((item) => item.id === zoneId) || assignee?.id.startsWith('agent-custom-');

  return <Dialog icon={ClipboardList} title="مهام القنوات" variant="hud" className="command-hud task-drawer" onClose={onClose}>
    <div className="field-stack">
      <label className="label"><span className="label-icon"><Radio size={15} aria-hidden="true" />القسم</span><select className="field" value={zoneId} disabled={saving} onChange={(event) => { setZone(event.target.value); setError(''); }}>
        <option value="">كل القنوات</option>{CHANNELS.map((room) => <option key={room.id} value={room.id}>{room.nameAr} ({workspaces[room.id]?.entries.length ?? 0})</option>)}
      </select></label>
      <section className="task-entries" aria-label="المهام المسجلة">
        <h3>المهام المسجلة <span className="badge">{entries.length}</span></h3>
        {sorted.length ? <ul>{sorted.map((entry) => {
          const source = taskSourceLabel(entry);
          const done = isFinished(entry);
          const assigneeName = agents[entry.targetAgentId ?? entry.authorAgentId]?.displayName;
          const brief = entry.payload['brief'];
          const response = entry.payload['directorResponse'];
          const executionNote = taskExecutionNote(entry);
          const focused = entry.id === focusedId;
          return <li key={entry.id} className={`task-entry${focused ? ' is-focused' : ''}`} tabIndex={focused ? -1 : undefined} data-initial-focus={focused ? '' : undefined}>
            <div><strong dir="auto">{entry.title}</strong><span className="badge">{ROOM_DISPLAY[entry.zoneId]?.label ?? CHANNEL_BY_ID[entry.zoneId]?.nameAr}</span></div>
            <div><span className={`badge tint ${done ? 'tone-mint' : 'tone-gold'}`}>{done ? <Check size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}{taskStage(entry)}</span><small>{[assigneeName, source].filter(Boolean).join(' · ') || 'بدون مسؤول'}</small></div>
            {executionNote && typeof response !== 'string' && <p className="field-note">{executionNote}</p>}
            {typeof response === 'string' && <details className="task-brief" open={focused || undefined}><summary>ردّ الوكيل</summary><p dir="auto">{response}</p></details>}
            {typeof brief === 'string' && brief !== entry.title && <details className="task-brief"><summary>تفاصيل المهمة</summary><p dir="auto">{brief}</p></details>}
          </li>;
        })}</ul> : <EmptyState icon={ClipboardList} title="لا توجد مهام مسجّلة" />}
      </section>
      {zoneId && <details className="manual-task">
        <summary>إسناد يدوي</summary>
        <form className="task-composer field-stack" onSubmit={async (event) => {
          event.preventDefault();
          if (locked || !assignee || ongoing.current) return;
          ongoing.current = true; setSaving(true); setError('');
          try {
            const result = await sendWorkspaceSignal(zoneId, assignee.id, title, { source: 'hq-board' });
            if (result.ok) setTitle('');
            else setError(result.reason === 'unconfirmed' ? 'لم يصل تأكيد الحفظ. تحقّق من اللوحة قبل إعادة الإسناد.' : 'تعذّر حفظ المهمة.');
          } finally { setSaving(false); ongoing.current = false; }
        }}>
          <label className="label">عنوان المهمة<input className="field" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: تجهيز خطة الأسبوع" dir="auto" disabled={saving || locked} /></label>
          <div className="task-composer-actions">
            <label className="label">الوكيل المسؤول<select className="field" value={assignee?.id ?? ''} disabled={saving || locked} onChange={(event) => setAssignee(event.target.value)}>
              {!assignees.length && <option value="">لا يوجد وكلاء متاحون</option>}
              {assignees.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
            </select></label>
            <button className="button primary" type="submit" disabled={!title.trim() || !assignee || locked || saving}><Plus size={16} aria-hidden="true" />{saving ? 'جارٍ الحفظ…' : 'إسناد'}</button>
          </div>
          {error && <p className="director-error" role="alert">{error}</p>}
          {locked ? <p className="field-note"><LockKeyhole size={14} className="inline-icon" aria-hidden="true" />الإسناد هنا متاح في خطة Pro.</p> : local && <p className="field-note">المهمة محلية لهذه الجلسة.</p>}
        </form>
      </details>}
    </div>
  </Dialog>;
}

export function SharedWorkspaceHUD() {
  const open = useWoraStore((s) => s.ui.showWorkspaceHUD);
  const toggle = useWoraStore((s) => s.toggleWorkspaceHUD);
  return open ? <WorkspacePanel onClose={() => toggle(false)} /> : null;
}
