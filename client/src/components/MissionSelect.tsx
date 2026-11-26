import type { MissionSummary } from '../os/api.js';
import { useI18n } from '../i18n/I18nContext.js';

export function MissionSelect({ missions, value, onChange, label }: {
  missions: MissionSummary[] | null;
  value: string | null;
  onChange: (id: string) => void;
  label: string;
}) {
  const { t } = useI18n();
  const ordered = [...(missions ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <label className="tech-select">
    <span>{label}</span>
    <select value={value ?? ''} onChange={(event) => { if (event.target.value) onChange(event.target.value); }} aria-label={label}>
      {ordered.length === 0 && <option value="">{t('workspace.noMission')}</option>}
      {ordered.map((mission) => <option key={mission.id} value={mission.id}>{mission.objective}</option>)}
    </select>
  </label>;
}
