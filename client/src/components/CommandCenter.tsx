import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Bot, BrainCircuit, CheckCircle2, ChevronRight, CircleAlert, CircleDashed, LoaderCircle, Network, SendHorizonal, Waypoints } from 'lucide-react';
import { osApi, OsApiError, type Agent, type MissionSummary } from '../os/api.js';
import { useI18n } from '../i18n/I18nContext.js';
import { Button } from './ui.js';
import type { PageId } from '../pages.js';

const STATUS_KEY: Record<string, string> = {
  planning: 'status.planning', running: 'status.running', awaiting_approval: 'status.awaiting_approval', completed: 'status.completed', failed: 'status.failed', blocked: 'status.blocked',
};

export function CommandCenter({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState('');
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [missionList, agentList] = await Promise.all([osApi.missions(), osApi.agents()]);
      setMissions(missionList);
      setAgents(agentList.filter((agent) => agent.status === 'active').slice(0, 6));
    } catch {
      // Surface as empty states below — the page stays usable while the API is unreachable.
      setMissions([]);
      setAgents([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeMissions = useMemo(() => (missions ?? []).filter((m) => m.status === 'running' || m.status === 'awaiting_approval' || m.status === 'planning'), [missions]);
  const recentMissions = useMemo(() => [...(missions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [missions]);

  async function launchBrief(brief: string) {
    if (!brief || launching) return;
    setLaunching(true);
    setError(null);
    try {
      await osApi.launchMission(brief);
      setDraft('');
      onNavigate('execution');
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : 'تعذر إطلاق المهمة.');
    } finally {
      setLaunching(false);
    }
  }
  function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void launchBrief(draft.trim());
  }

  const examples = [t('home.ex1'), t('home.ex2'), t('home.ex3')];

  return <div className="cc-page">
    {/* ── Hero: the Execute path — one field, zero setup ─────────────────── */}
    <section className="cc-hero" aria-labelledby="cc-title">
      <p className="cc-eyebrow">{t('home.eyebrow')}</p>
      <h1 id="cc-title">{t('home.title')}</h1>
      <p className="cc-subtitle">{t('home.subtitle')}</p>
      <form className="cc-launch" onSubmit={(event) => void launch(event)}>
        <textarea
          dir="auto"
          rows={2}
          maxLength={1200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void launchBrief(draft.trim()); } }}
          placeholder={t('home.inputPlaceholder')}
          aria-label={t('commandBar.ariaLabel')}
        />
        <div className="cc-launch-foot">
          <span className="cc-examples"><small>{t('home.examplesLabel')}</small>{examples.map((example) => <button key={example} type="button" className="cc-example" dir="auto" onClick={() => setDraft(example)}>{example}</button>)}</span>
          <Button type="submit" variant="primary" className="cc-run" loading={launching} icon={SendHorizonal} disabled={!draft.trim()}>
            {launching ? t('home.running') : t('home.runNow')}
          </Button>
        </div>
      </form>
      {error && <p role="alert" className="cc-error"><CircleAlert size={15} aria-hidden="true" />{error}</p>}
    </section>

    {/* ── Three entry paths ──────────────────────────────────────────────── */}
    <section className="cc-paths" aria-label={t('home.pathsTitle')}>
      <button type="button" className="cc-path cc-path-featured" onClick={() => document.getElementById('cc-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
        <Waypoints size={20} aria-hidden="true" />
        <span className="cc-path-text"><strong>{t('home.pathExecuteTitle')}</strong><small>{t('home.pathExecuteBody')}</small><em>{t('home.openLaunch')}<ChevronRight size={14} aria-hidden="true" /></em></span>
      </button>
      <button type="button" className="cc-path" onClick={() => onNavigate('agents')}>
        <Bot size={20} aria-hidden="true" />
        <span className="cc-path-text"><strong>{t('home.pathAgentTitle')}</strong><small>{t('home.pathAgentBody')}</small><em>{t('home.openAgents')}<ChevronRight size={14} aria-hidden="true" /></em></span>
      </button>
      <button type="button" className="cc-path" onClick={() => onNavigate('organizations')}>
        <Network size={20} aria-hidden="true" />
        <span className="cc-path-text"><strong>{t('home.pathOrgTitle')}</strong><small>{t('home.pathOrgBody')}</small><em>{t('home.openOrgs')}<ChevronRight size={14} aria-hidden="true" /></em></span>
      </button>
    </section>

    <div className="cc-columns">
      {/* ── Live work ────────────────────────────────────────────────────── */}
      <section className="cc-panel" aria-labelledby="cc-live">
        <div className="cc-panel-head">
          <h2 id="cc-live">{t('home.liveTitle')}</h2>
          <button type="button" className="cc-link" onClick={() => onNavigate('execution')}>{t('home.recentAll')}<ArrowLeft size={14} aria-hidden="true" /></button>
        </div>
        {missions === null && <p className="cc-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" />{t('app.loading')}</p>}
        {missions !== null && activeMissions.length === 0 && <div className="cc-empty"><CircleDashed size={22} aria-hidden="true" /><p>{t('home.liveEmpty')}</p></div>}
        <ul className="cc-missions">
          {activeMissions.map((mission) => (
            <li key={mission.id}>
              <button type="button" className="cc-mission-row" onClick={() => onNavigate('execution')}>
                <span className={`cc-status cc-status-${mission.status}`}>{t(STATUS_KEY[mission.status] ?? 'status.running')}</span>
                <span className="cc-mission-text" dir="auto">{mission.objective}</span>
                {mission.status === 'awaiting_approval' && <span className="cc-attention">{t('home.liveNeedsAttention')}</span>}
              </button>
            </li>
          ))}
        </ul>

        <h3 className="cc-subhead">{t('home.recentTitle')}</h3>
        {missions !== null && recentMissions.length === 0 && <div className="cc-empty"><CheckCircle2 size={20} aria-hidden="true" /><p>{t('home.recentEmpty')}</p></div>}
        <ul className="cc-missions cc-recent">
          {recentMissions.map((mission) => (
            <li key={mission.id}>
              <button type="button" className="cc-mission-row" onClick={() => onNavigate('execution')}>
                <span className={`cc-status cc-status-${mission.status}`}>{t(STATUS_KEY[mission.status] ?? 'status.completed')}</span>
                <span className="cc-mission-text" dir="auto">{mission.objective}</span>
                <small className="cc-date">{new Date(mission.createdAt).toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'short', day: 'numeric' })}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Your agents ──────────────────────────────────────────────────── */}
      <section className="cc-panel" aria-labelledby="cc-agents">
        <div className="cc-panel-head">
          <h2 id="cc-agents"><BrainCircuit size={15} aria-hidden="true" /> {t('home.agentsTitle')}</h2>
          <button type="button" className="cc-link" onClick={() => onNavigate('agents')}>{t('home.agentsAll')}<ArrowLeft size={14} aria-hidden="true" /></button>
        </div>
        <p className="cc-seed-note">{t('home.agentsSeededNote')}</p>
        {agents === null && <p className="cc-loading"><LoaderCircle size={16} className="os-spin" aria-hidden="true" />{t('app.loading')}</p>}
        {agents !== null && agents.length === 0 && <div className="cc-empty"><Bot size={20} aria-hidden="true" /><p>{t('home.agentsEmpty')}</p></div>}
        <ul className="cc-agents">
          {agents?.map((agent) => (
            <li key={agent.id}>
              <button type="button" className="cc-agent-row" onClick={() => onNavigate('agents')}>
                <span className="cc-agent-avatar" aria-hidden="true">{agent.name.slice(0, 2).toUpperCase()}</span>
                <span className="cc-agent-meta"><strong dir="auto">{agent.name}</strong><small dir="auto">{agent.role}</small></span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  </div>;
}
