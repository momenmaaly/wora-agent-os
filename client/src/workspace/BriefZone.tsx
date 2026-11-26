import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, CircleDashed, GitBranch, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi, type OsState, type RuntimeStatus } from '../os/api.js';
import { missionStatusLabel, missionTone } from '../os/labels.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { extensionsApi, type ExtensionSummary } from '../extensions/api.js';
import { Button, StateMessage, StatusBadge } from '../components/ui.js';
import { formatDate } from './model.js';

export function BriefZone({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const feed = useMissionFeed();
  const [draft, setDraft] = useState('');
  const [composite, setComposite] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<OsState | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [extensions, setExtensions] = useState<ExtensionSummary | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [readinessError, setReadinessError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextState, nextRuntime, nextExtensions, tools] = await Promise.all([
          osApi.state(), osApi.runtimeStatus(), extensionsApi.summary(), extensionsApi.tools(),
        ]);
        if (cancelled) return;
        setState(nextState);
        setRuntime(nextRuntime);
        setExtensions(nextExtensions);
        setToolCount(tools.core.length);
        setReadinessError(false);
      } catch {
        if (!cancelled) setReadinessError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const latestDetail = feed.detail;
  const active = feed.missions?.filter((mission) => ['planning', 'running', 'awaiting_approval', 'paused'].includes(mission.status)) ?? [];
  const examples = [t('op.brief.example1'), t('op.brief.example2'), t('op.brief.example3')];
  const loadError = feed.error instanceof OsApiError ? feed.error.message : t('op.brief.loadError');
  const canSubmit = Boolean(draft.trim()) && !launching;

  const readiness = useMemo(() => [
    { label: t('op.brief.agents'), value: state?.agents ?? '—', icon: Bot },
    { label: t('op.brief.tools'), value: toolCount ?? '—', icon: ShieldCheck },
    { label: t('op.brief.skills'), value: extensions?.skills ?? '—', icon: Sparkles },
    { label: t('op.brief.memory'), value: state?.memory ?? '—', icon: GitBranch },
  ], [state, toolCount, extensions, t]);

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = draft.trim();
    if (!objective || launching) {
      if (!objective) setLaunchError(t('op.brief.objectiveRequired'));
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    setNotice(null);
    try {
      const mission = await feed.launch(objective, composite ? 'composite' : undefined);
      try { sessionStorage.setItem('wora:selectedMission', mission.id); } catch { /* private mode */ }
      setDraft('');
      setNotice(t('op.brief.launchSuccess'));
      onNavigate('run');
    } catch (err) {
      setLaunchError(err instanceof OsApiError ? err.message : t('op.brief.launchError'));
    } finally {
      setLaunching(false);
    }
  }

  function openMission(id: string) {
    try { sessionStorage.setItem('wora:selectedMission', id); } catch { /* private mode */ }
    onNavigate('run');
  }

  return <div className="op-zone op-brief">
    <header className="op-zone-head">
      <div>
        <p className="op-eyebrow">{t('op.eyebrow')}</p>
        <h1>{t('op.brief.title')}</h1>
        <p>{t('op.brief.subtitle')}</p>
      </div>
      <div className="op-zone-state" aria-live="polite">
        <span><GitBranch size={14} aria-hidden="true" />{active.length} {t('op.brief.activeCount')}</span>
        <span><ShieldCheck size={14} aria-hidden="true" />{state?.approvals.pending ?? 0} {t('op.brief.approvalCount')}</span>
      </div>
    </header>

    <div className="op-brief-grid">
      <section className="op-composer" aria-labelledby="op-brief-composer">
        <div className="op-composer-head">
          <span className="op-kicker"><Sparkles size={14} aria-hidden="true" /> WORA Intelligence</span>
          <h2 id="op-brief-composer">{t('op.brief.composerTitle')}</h2>
          <p>{t('op.brief.composerHint')}</p>
        </div>
        <form onSubmit={(event) => void launch(event)}>
          <textarea
            dir="auto" rows={5} maxLength={4000} value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
            placeholder={t('op.brief.placeholder')}
            aria-label={t('op.brief.composerTitle')}
          />
          <div className="op-composer-bar">
            <div className="op-composer-context">
              <span className="op-context-chip"><ShieldCheck size={13} aria-hidden="true" />{t('op.brief.context')}: {t('op.brief.contextValue')}</span>
              <label className="op-check" title={t('op.brief.compositionHint')}>
                <input type="checkbox" checked={composite} onChange={(event) => setComposite(event.target.checked)} />
                <span>{t('op.brief.composition')}<small>{t('op.brief.compositionHint')}</small></span>
              </label>
            </div>
            <Button type="submit" variant="primary" loading={launching} icon={Play} disabled={!canSubmit}>
              {launching ? t('op.brief.submitting') : t('op.brief.submit')}
            </Button>
          </div>
        </form>
        <div className="op-examples">
          <small>{t('op.brief.examples')}</small>
          {examples.map((example) => <button key={example} type="button" className="op-example" dir="auto" onClick={() => setDraft(example)}>{example}</button>)}
        </div>
        {launchError && <p className="op-alert" role="alert">{launchError}</p>}
        {notice && <p className="op-notice" role="status">{notice}</p>}
      </section>

      <aside className="op-side" aria-labelledby="op-readiness-title">
        <section className="op-panel">
          <div className="op-panel-head">
            <div><h2 id="op-readiness-title">{t('op.brief.readiness')}</h2><p>{t('op.brief.readinessHint')}</p></div>
            <button type="button" className="icon-button" aria-label={t('op.refresh')} title={t('op.refresh')} onClick={() => window.location.reload()}><RefreshCw size={15} aria-hidden="true" /></button>
          </div>
          {readinessError && <StateMessage variant="warning" title={t('op.brief.readiness')}><p>{t('op.error')}</p></StateMessage>}
          <div className="op-readiness-grid">
            {readiness.map((item) => <div key={item.label} className="op-readiness-item">
              <item.icon size={15} aria-hidden="true" /><span>{item.label}</span><strong>{item.value}</strong>
            </div>)}
          </div>
          <p className="op-muted">{runtime ? `${t('op.brief.runtime')}: ${runtime.mode} · ${runtime.durableStore ? t('op.system.durableStore') : t('op.capabilities.unavailable')}` : '—'}</p>
        </section>

        <section className="op-panel">
          <div className="op-panel-head"><div><h2>{t('op.brief.understood')}</h2><p>{t('op.brief.understoodHint')}</p></div></div>
          {feed.loading && !feed.detail && <StateMessage variant="loading" title={t('op.loading')} />}
          {!feed.loading && feed.error !== null && <StateMessage variant="error" title={t('op.brief.loadError')}><p>{loadError}</p><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('op.retry')}</button></StateMessage>}
          {!feed.loading && !feed.error && !latestDetail && <div className="op-empty"><CircleDashed size={22} aria-hidden="true" /><strong>{t('op.brief.noUnderstanding')}</strong></div>}
          {latestDetail && <div className="op-understood">
            <StatusBadge tone={missionTone(latestDetail.status)} dot>{missionStatusLabel(t, latestDetail.status)}</StatusBadge>
            <strong dir="auto">{latestDetail.objective}</strong>
            {latestDetail.problemProfile && <p className="op-muted">{latestDetail.problemProfile.domain} · {Math.round(latestDetail.problemProfile.confidence * 100)}%</p>}
            {latestDetail.problemProfile?.missingInformation.length ? <p className="op-muted">{latestDetail.problemProfile.missingInformation.slice(0, 3).join(' · ')}</p> : null}
            <button type="button" className="op-text-link" onClick={() => openMission(latestDetail.id)}>{t('op.brief.openRun')}<ArrowRight size={14} aria-hidden="true" /></button>
          </div>}
        </section>
      </aside>
    </div>

    <section className="op-panel" aria-labelledby="op-recent-title">
      <div className="op-panel-head">
        <div><h2 id="op-recent-title">{t('op.brief.recent')}</h2><p>{t('op.brief.recentHint')}</p></div>
        <span className="op-muted">{feed.missions?.length ?? 0} {t((feed.missions?.length ?? 0) === 1 ? 'op.brief.missionOne' : 'op.brief.missionCount')}</span>
      </div>
      {feed.missions?.length === 0 && <div className="op-empty"><CircleDashed size={22} aria-hidden="true" /><strong>{t('op.brief.noMissions')}</strong><p>{t('op.brief.noMissionsBody')}</p></div>}
      {feed.missions && feed.missions.length > 0 && <ul className="op-mission-list">
        {feed.missions.slice(0, 8).map((mission) => <li key={mission.id}>
          <button type="button" className="op-mission-row" onClick={() => openMission(mission.id)}>
            <span className="op-mission-copy"><strong dir="auto">{mission.objective}</strong><small>{formatDate(mission.updatedAt, lang)} · {mission.id}</small></span>
            <StatusBadge tone={missionTone(mission.status)} dot>{missionStatusLabel(t, mission.status)}</StatusBadge>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </li>)}
      </ul>}
    </section>
  </div>;
}
