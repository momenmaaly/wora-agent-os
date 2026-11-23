import { useWoraStore } from '../store/useWoraStore.js';
import { useI18n } from '../i18n/I18nContext.js';

/** Real socket connection state only — no decorative KPIs. */
export function CompanyStatusStrip() {
  const connected = useWoraStore((state) => state.connected);
  const serverMode = useWoraStore((state) => state.serverMode);
  const { t } = useI18n();
  const mode = connected
    ? serverMode === 'server' ? t('statusBar.server') : serverMode === 'preview' ? t('statusBar.preview') : t('statusBar.session')
    : t('statusBar.offline');
  return <div className="company-status-strip" role="status" aria-label={t('statusBar.aria')}>
    <span className={`company-operational${connected ? '' : ' is-offline'}`}><span className="status-dot" />{mode}</span>
  </div>;
}
