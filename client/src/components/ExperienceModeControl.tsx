import { useI18n } from '../i18n/I18nContext.js';
import { EXPERIENCE_MODES, useExperienceMode, type ExperienceMode } from '../experience/mode.js';

const LABEL_KEY: Record<ExperienceMode, string> = {
  simple: 'op.experience.simple',
  guided: 'op.experience.guided',
  advanced: 'op.experience.advanced',
};

export function ExperienceModeControl({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useExperienceMode();
  return <div className={`op-mode${compact ? ' is-compact' : ''}`}>
    <span className="op-mode-label">{t('op.experience.label')}</span>
    <div className="op-mode-options" role="group" aria-label={t('op.experience.label')}>
      {EXPERIENCE_MODES.map((entry) => <button
        key={entry}
        type="button"
        className="op-mode-option"
        aria-pressed={mode === entry}
        onClick={() => setMode(entry)}
      >{t(LABEL_KEY[entry])}</button>)}
    </div>
  </div>;
}
