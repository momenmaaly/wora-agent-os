import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Box, Building2, CheckCircle2, CircleAlert, LoaderCircle, Workflow } from 'lucide-react';
import { OsApiError, osApi, type Organization, type OrgBuildResult } from '../os/api.js';
import { useI18n } from '../i18n/I18nContext.js';
import type { PageId } from '../pages.js';

export function OrganizationsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t } = useI18n();
  const [objective, setObjective] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrgBuildResult | null>(null);
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);

  const load = useCallback(async () => {
    try { setOrganizations(await osApi.organizations()); }
    catch (err) { setError(err instanceof OsApiError ? err.message : 'تعذر تحميل المنظمات.'); setOrganizations([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function build(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || objective.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const built = await osApi.buildOrganization({ objective: objective.trim(), name: name.trim() || undefined });
      setResult(built);
      setObjective('');
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر بناء المنظمة.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="os-page">
    <header className="os-page-head">
      <div>
        <h1><Building2 size={20} aria-hidden="true" /> {t('orgs.title')}</h1>
        <p className="subtle">{t('orgs.subtitle')}</p>
      </div>
      <div className="os-tabs">
        <button type="button" className="os-tab" onClick={() => onNavigate('campus')}><Box size={14} aria-hidden="true" /> {t('orgs.view3d')}</button>
      </div>
    </header>

    {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

    <form className="os-org-builder panel panel-pad" onSubmit={(event) => void build(event)}>
      <h2><Building2 size={17} aria-hidden="true" /> {t('orgs.buildTitle')}</h2>
      <textarea dir="auto" rows={3} required minLength={10} maxLength={4000} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder={t('orgs.objectivePlaceholder')} aria-label={t('orgs.objectiveLabel')} />
      <div className="os-org-builder-foot">
        <input dir="auto" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('orgs.namePlaceholder')} aria-label={t('orgs.nameLabel')} />
        <button type="submit" className="button primary" disabled={busy || objective.trim().length < 10}>{busy ? <LoaderCircle size={15} className="os-spin" aria-hidden="true" /> : <Workflow size={15} aria-hidden="true" />} {busy ? t('orgs.building') : t('orgs.build')}</button>
      </div>
    </form>

    {result && (
      <div className="os-org-result panel panel-pad" role="status">
        <h3><CheckCircle2 size={16} aria-hidden="true" /> {t('orgs.built')} — «{result.name}» <span className="os-spec-chip">{result.template}</span></h3>
        <p className="subtle">{result.agentsCreated} {t('orgs.agentsCreated')} · {result.departments.length} {t('orgs.departments')}</p>
        <div className="os-dept-chips">{result.departments.map((d) => <span key={d.id} className="os-chip">{d.name}</span>)}</div>
      </div>
    )}

    <h2 className="cc-subhead" style={{ paddingInline: 4 }}>{t('orgs.listTitle')}</h2>
    {organizations === null && <p className="os-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" /> {t('app.loading')}</p>}
    <div className="os-org-grid">
      {organizations?.map((org) => (
        <article key={org.id} className="os-org-card panel panel-pad">
          <h3 dir="auto">{org.name}</h3>
          <p className="subtle" dir="auto">{org.objective}</p>
          <div className="os-dept-chips">{org.departments.map((d) => <span key={d.id} className="os-chip" title={d.kpis.join(' · ')}>{d.name}</span>)}</div>
          <small className="subtle mono">{org.id} · {org.template}</small>
        </article>
      ))}
      {organizations?.length === 0 && <p className="os-empty">{t('orgs.empty')}</p>}
    </div>
  </div>;
}
