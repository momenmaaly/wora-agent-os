import { useCallback, useEffect, useState } from 'react';
import { Laptop, Shield, Users } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi, type DeviceRecord } from '../os/api.js';
import type { PageId } from '../pages.js';
import { Notice, PageHeader, StateMessage, StatusBadge } from './ui.js';

interface RolesState {
  me: { userId: string; role: 'owner' | 'admin' | 'member' | 'viewer' };
  members: Array<{ userId: string; role: string; grantedBy: string }>;
}

export function SecurityPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t } = useI18n();
  const [roles, setRoles] = useState<RolesState | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[] | null>(null);
  const [policy, setPolicy] = useState<'balanced' | 'autopilot' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roleState, deviceList, autonomy] = await Promise.all([osApi.roles(), osApi.devices(), osApi.autonomy()]);
      setRoles(roleState);
      setDevices(deviceList);
      setPolicy(autonomy.policy);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('security.error'));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const trusted = (devices ?? []).filter((device) => device.status === 'paired');

  return <div className="tech-page">
    <PageHeader icon={Shield} eyebrow={t('security.eyebrow')} title={t('security.title')} description={t('security.subtitle')}
      action={<button type="button" className="button small" onClick={() => onNavigate('system')}>{t('security.manage')}</button>} />
    <Notice>{t('security.readOnly')}</Notice>
    {loading && <StateMessage variant="loading" title={t('app.loading')} />}
    {!loading && error && <StateMessage variant="error" title={t('security.error')}><p>{error}</p><button type="button" className="button small" onClick={() => void load()}>{t('workspace.retry')}</button></StateMessage>}
    {!loading && !error && <div className="tech-security-grid">
      <section className="tech-security-card">
        <h2><Users size={16} aria-hidden="true" /> {t('security.role')}</h2>
        {roles ? <><p className="tech-security-value">{roles.me.role}</p><small dir="ltr">{roles.me.userId}</small><p className="tech-muted">{t('security.members')}: {roles.members.length}</p></> : <p className="tech-muted">—</p>}
      </section>
      <section className="tech-security-card">
        <h2><Laptop size={16} aria-hidden="true" /> {t('security.devices')}</h2>
        {trusted.length === 0 ? <p className="tech-muted">{t('security.noDevices')}</p> : <ul className="tech-security-devices">
          {trusted.map((device) => <li key={device.id}><span><strong dir="auto">{device.name}</strong><small>{device.platform}</small></span><StatusBadge tone="success" dot>{t('security.trusted')}</StatusBadge></li>)}
        </ul>}
      </section>
      <section className="tech-security-card">
        <h2><Shield size={16} aria-hidden="true" /> {t('security.autonomy')}</h2>
        {policy ? <><p className="tech-security-value">{policy === 'autopilot' ? t('security.autopilot') : t('security.balanced')}</p><p className="tech-muted">{policy === 'autopilot' ? t('security.autopilot') : t('security.balanced')}</p></> : <p className="tech-muted">—</p>}
      </section>
    </div>}
  </div>;
}
