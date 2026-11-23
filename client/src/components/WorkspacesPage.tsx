import { Boxes, Building2, ServerCog, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import type { PageId } from '../pages.js';

/**
 * Workspaces are optional — WORA executes missions without one.
 * This page states the real production tenancy model and what is NOT built yet
 * (no fake plan gates, no simulated limits).
 */
export function WorkspacesPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t } = useI18n();
  const production = typeof window !== 'undefined' && !/wora-preview|localhost|127\.0\.0\.1/.test(window.location.hostname);
  return <div className="os-page cc-workspace-page">
    <header className="os-page-head">
      <div>
        <h1><Boxes size={20} aria-hidden="true" /> {t('workspaces.title')}</h1>
        <p className="subtle">{t('workspaces.subtitle')}</p>
      </div>
    </header>

    <div className="cc-workspace-grid">
      <section className="panel panel-pad cc-workspace-card">
        <h2><ShieldCheck size={17} aria-hidden="true" /> {t('workspaces.individualTitle')}</h2>
        <p>{t('workspaces.individualBody')}</p>
      </section>

      <section className="panel panel-pad cc-workspace-card">
        <h2><ServerCog size={17} aria-hidden="true" /> {t('workspaces.statusTitle')}</h2>
        <p>{t('workspaces.statusBody')}</p>
        <p className="cc-workspace-status"><span className={`status-dot${production ? ' is-live' : ''}`} />{production ? t('workspaces.statusPersonal') : t('workspaces.statusPreview')}</p>
      </section>

      <section className="panel panel-pad cc-workspace-card">
        <h2><Building2 size={17} aria-hidden="true" /> {t('workspaces.multiTitle')}</h2>
        <p>{t('workspaces.multiBody')}</p>
        <p className="cc-plan-note">{t('workspaces.planNote')}</p>
        <button type="button" className="button ghost" onClick={() => onNavigate('system')}>{t('workspaces.goSystem')}</button>
      </section>
    </div>
  </div>;
}
