import { useState } from 'react';
import { Plus, UserRoundPlus } from 'lucide-react';
import { isRoomLockedForPlan } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { OFFICE_ROOMS } from '../office/layout.js';
import { BRAIN_MODELS, BRAIN_PROVIDER_LABELS, BrainProvider } from '../types.js';
import { Dialog, Notice } from './ui.js';

const COLORS = [
  ['بنفسجي', '#7555dc'], ['أزرق', '#267dc4'], ['ذهبي', '#b57829'], ['أخضر', '#238c70'],
  ['أرجواني', '#9b4dba'], ['وردي', '#ca4c80'], ['فيروزي', '#258b91'], ['رمادي', '#627187'],
] as const;

function HireForm({ onClose, onHired }: { onClose: () => void; onHired: (id: string) => void }) {
  const plan = useBillingStore((s) => s.plan);
  const hire = useWoraStore((s) => s.hireAgent);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [zone, setZone] = useState('zone-planning');
  const [color, setColor] = useState<string>(COLORS[0][1]);
  const [provider, setProvider] = useState(BrainProvider.Google);
  const [model, setModel] = useState(BRAIN_MODELS[BrainProvider.Google][0]!);
  const valid = name.trim().length >= 2 && role.trim().length >= 2 && !isRoomLockedForPlan(zone, plan);

  return <Dialog icon={UserRoundPlus} title="إضافة وكيل جديد" description="حدّد دور الوكيل والمكان الذي يبدأ منه العمل." onClose={onClose}
    footer={<><button type="button" className="button ghost" onClick={onClose}>إلغاء</button><button type="submit" form="hire-agent" className="button primary" disabled={!valid}><Plus size={17} />إضافة إلى الفريق</button></>}>
    <form id="hire-agent" className="field-stack" onSubmit={(event) => {
      event.preventDefault();
      if (!valid) return;
      const agent = hire({ displayName: name, customRole: role, zoneId: zone, avatarColor: color, provider, model });
      onClose(); onHired(agent.id);
    }}>
      <div className="field-grid">
        <label className="label">اسم الوكيل<input className="field" data-initial-focus value={name} onChange={(event) => setName(event.target.value)} maxLength={36} minLength={2} placeholder="مثال: Karim" dir="auto" required /></label>
        <label className="label">الدور<input className="field" value={role} onChange={(event) => setRole(event.target.value)} maxLength={65} minLength={2} placeholder="مثال: مصمّم تجربة المستخدم" dir="auto" required /></label>
      </div>
      <label className="label">القسم الأساسي<select className="field" value={zone} onChange={(event) => setZone(event.target.value)}>{OFFICE_ROOMS.map((room) => {
        const locked = isRoomLockedForPlan(room.id, plan);
        return <option key={room.id} value={room.id} disabled={locked}>{room.nameAr}{locked ? ' — Pro' : ''}</option>;
      })}</select></label>
      <fieldset className="swatch-field"><legend>لون شارة الوكيل</legend>
        <div>{COLORS.map(([label, value]) => <button type="button" className="color-swatch" key={value} style={{ '--swatch': value } as React.CSSProperties} aria-label={label} aria-pressed={color === value} onClick={() => setColor(value)} />)}</div>
      </fieldset>
      <div className="field-grid">
        <label className="label">مزوّد النموذج<select className="field" value={provider} onChange={(event) => {
          const next = event.target.value as BrainProvider;
          setProvider(next); setModel(BRAIN_MODELS[next][0]!);
        }}>{Object.entries(BRAIN_PROVIDER_LABELS).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label className="label">النموذج<select className="field" dir="ltr" value={model} onChange={(event) => setModel(event.target.value)}>{BRAIN_MODELS[provider].map((id) => <option key={id}>{id}</option>)}</select></label>
      </div>
      <Notice>يبدأ الوكيل من الاستقبال ويتجه إلى مكتبه على الخريطة. الوكلاء المضافون هنا متاحون لهذه الجلسة فقط.</Notice>
    </form>
  </Dialog>;
}

export function HireAgentModal({ onHired }: { onHired: (id: string) => void }) {
  const open = useWoraStore((s) => s.ui.showHireModal);
  const setOpen = useWoraStore((s) => s.setShowHireModal);
  return open ? <HireForm onClose={() => setOpen(false)} onHired={onHired} /> : null;
}
