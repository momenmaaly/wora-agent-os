import { useCallback, useEffect, useState } from 'react';
import { Activity, CircleAlert, Database, RefreshCw, ServerCog, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi, type ExecutionLimits, type OsState, type RecoveryReport, type RuntimeStatus } from '../os/api.js';
import type { PageId } from '../pages.js';
import { ApprovalsPage } from '../components/ApprovalsPage.js';
import { ActivityPage } from '../components/ActivityPage.js';
import { SecurityPage } from '../components/SecurityPage.js';
import { SystemConsole } from '../components/SystemConsole.js';
import { StateMessage } from '../components/ui.js';

type SystemTab = 'overview' | 'approvals' | 'activity' | 'security' | 'advanced';

export function SystemZone({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SystemTab>('overview');
  const [state, setState] = useState<OsState | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [recovery, setRecovery] = useState<RecoveryReport | null>(null);
  const [limits, setLimits] = useState<ExecutionLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextState, nextRuntime, nextRecovery, nextLimits] = await Promise.all([
        osApi.state(), osApi.runtimeStatus(), osApi.recovery(), osApi.executionLimits(),
      ]);
      setState(nextState);
      setRuntime(nextRuntime);
      setRecovery(nextRecovery);
      setLimits(nextLimits);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('op.system.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function go(page: PageId) {
    if (page === 'execution') onNavigate('run');
    else if (page === 'artifacts') onNavigate('library');
    else onNavigate(page);
  }

  return <div className="op-zone op-system">
    <header className="op-zone-head">
      <div>
        <p className="op-eyebrow">{t('op.eyebrow')}</p>
        <h1>{t('op.system.title')}</h1>
        <p>{t('op.system.subtitle')}</p>
      </div>
      <div className="op-zone-state">
        <span><ShieldCheck size={14} aria-hidden="true" />{state?.approvals.pending ?? 0} {t('op.system.approvalsPending')}</span>
        <button type="button" className="icon-button" onClick={() => void load()} aria-label={t('op.refresh')} title={t('op.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
      </div>
    </header>

    <div className="op-tabs" role="tablist" aria-label={t('op.system.title')}>
      {(['overview', 'approvals', 'activity', 'security', 'advanced'] as const).map((entry) => <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={`op-tab${tab === entry ? ' is-active' : ''}`} onClick={() => setTab(entry)}>
        {entry === 'overview' && <ServerCog size={15} aria-hidden="true" />}
        {entry === 'approvals' && <ShieldCheck size={15} aria-hidden="true" />}
        {entry === 'activity' && <Activity size={15} aria-hidden="true" />}
        {entry === 'security' && <ShieldCheck size={15} aria-hidden="true" />}
        {entry === 'advanced' && <Database size={15} aria-hidden="true" />}
        {t(`op.system.${entry}`)}
      </button>)}
    </div>

    {tab === 'overview' && <>
      {loading && <StateMessage variant="loading" title={t('op.loading')} />}
      {!loading && error && <StateMessage variant="error" title={t('op.system.loadError')}><p>{error}</p><button type="button" className="button small" onClick={() => void load()}>{t('op.retry')}</button></StateMessage>}
      {!loading && !error && state && <div className="op-system-grid">
        <section className="op-panel">
          <div className="op-panel-head"><div><h2>{t('op.system.state')}</h2><p>{t('op.system.subtitle')}</p></div></div>
          <dl className="op-meta-list">
            <div><dt>{t('op.system.agents')}</dt><dd>{state.agents}</dd></div>
            <div><dt>{t('op.system.missions')}</dt><dd>{state.missions.total}</dd></div>
            <div><dt>{t('op.system.tasks')}</dt><dd>{state.tasks.completed + state.tasks.failed + state.tasks.blocked}</dd></div>
            <div><dt>{t('op.system.approvalsPending')}</dt><dd>{state.approvals.pending}</dd></div>
            <div><dt>{t('op.system.memory')}</dt><dd>{state.memory}</dd></div>
            <div><dt>{t('op.system.artifacts')}</dt><dd>{state.artifacts}</dd></div>
          </dl>
        </section>

        <section className="op-panel">
          <div className="op-panel-head"><div><h2>{t('op.system.runtime')}</h2><p>{runtime?.independentWorkers ?? '—'}</p></div></div>
          {runtime && <dl className="op-meta-list">
            <div><dt>{t('op.system.mode')}</dt><dd>{runtime.mode}</dd></div>
            <div><dt>{t('op.system.durableStore')}</dt><dd>{runtime.durableStore ? t('op.system.yes') : t('op.system.no')}</dd></div>
            <div><dt>{t('op.system.activeLeases')}</dt><dd>{runtime.activeLeases}</dd></div>
            <div><dt>{t('op.system.runnable')}</dt><dd>{runtime.runnableMissions.length}</dd></div>
          </dl>}
          {runtime?.limitations.length ? <ul className="op-list op-muted">{runtime.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </section>

        <section className="op-panel">
          <div className="op-panel-head"><div><h2>{t('op.system.recovery')}</h2><p>{t('op.system.limits')}</p></div></div>
          {recovery && <dl className="op-meta-list">
            <div><dt>{t('op.system.approvalsPending')}</dt><dd>{recovery.pendingApprovals}</dd></div>
            <div><dt>{t('op.system.activeLeases')}</dt><dd>{recovery.activeLeases}</dd></div>
            <div><dt>{t('op.system.runnable')}</dt><dd>{recovery.resumable ? t('op.system.yes') : t('op.system.no')}</dd></div>
          </dl>}
          {limits && <dl className="op-meta-list">
            <div><dt>maxConcurrentTasks</dt><dd>{limits.maxConcurrentTasks}</dd></div>
            <div><dt>leaseTtlMs</dt><dd>{limits.leaseTtlMs}</dd></div>
            <div><dt>maxAttempts</dt><dd>{limits.maxAttempts}</dd></div>
          </dl>}
          <button type="button" className="op-text-link" onClick={() => setTab('approvals')}>{t('op.system.approvals')}</button>
        </section>
      </div>}
    </>}

    {tab === 'approvals' && <div className="op-embed"><ApprovalsPage onNavigate={go} /></div>}
    {tab === 'activity' && <div className="op-embed"><ActivityPage /></div>}
    {tab === 'security' && <div className="op-embed"><SecurityPage onNavigate={go} /></div>}
    {tab === 'advanced' && <div className="op-embed"><SystemConsole /></div>}
  </div>;
}
