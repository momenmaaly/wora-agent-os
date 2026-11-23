import { lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { CompanyHeader } from './components/CompanyHeader.js';
import { CommandCenter } from './components/CommandCenter.js';
import { OrganizationsPage } from './components/OrganizationsPage.js';
import { WorkspacesPage } from './components/WorkspacesPage.js';
import { CompanySidebar } from './components/CompanySidebar.js';
import { ExecutiveCommandBar } from './components/ExecutiveCommandBar.js';
import { HireAgentModal } from './components/HireAgentModal.js';
import { ModelSwapModal } from './components/ModelSwapModal.js';
import { ChatDrawer } from './components/ChatDrawer.js';
import { WorkspaceBoard } from './components/WorkspaceBoard.js';
import { AgentSkillsDialog } from './components/AgentSkillsDialog.js';
import { QuickSearch } from './components/QuickSearch.js';
import { WorkspaceSettings } from './components/WorkspaceSettings.js';
import { WorkspacePage } from './components/WorkspacePage.js';
import { Dialog } from './components/ui.js';
import { useSocketLifecycle } from './hooks/useSocket.js';
import { useOfficeMotion, useOfficeSimulation } from './office/useOfficeSimulation.js';
import { DIRECTOR_ROOM_ID } from './office/work.js';
import { officeHash, workspaceRoute, type PageId } from './pages.js';
import { useWoraStore } from './store/useWoraStore.js';
import { useI18n } from './i18n/I18nContext.js';
import { initBoardSync } from './store/boardSync.js';
import { osApi } from './os/api.js';

initBoardSync(); // pull the durable workspace board once per boot (server wins); safe to call before React mounts

const Campus = lazy(() => import('./components/Campus.js').then((module) => ({ default: module.Campus })));
const Director = lazy(() => import('./components/DirectorOffice.js').then((module) => ({ default: module.DirectorOffice })));
const Projects = lazy(() => import('./components/ProjectOSBoard.js').then((module) => ({ default: module.ProjectOSBoard })));
const Agents = lazy(() => import('./components/AgentRegistry.js').then((module) => ({ default: module.AgentRegistry })));
const Execution = lazy(() => import('./components/ExecutionCenter.js').then((module) => ({ default: module.ExecutionCenter })));
const Intelligence = lazy(() => import('./components/IntelligenceHub.js').then((module) => ({ default: module.IntelligenceHub })));
const Extensions = lazy(() => import('./components/ExtensionsHub.js').then((module) => ({ default: module.ExtensionsHub })));
const SystemConsole = lazy(() => import('./components/SystemConsole.js').then((module) => ({ default: module.SystemConsole })));
const Studio = lazy(() => import('./components/ProductStudio.js').then((module) => ({ default: module.ProductStudio })));
const Models = lazy(() => import('./components/ModelHub.js').then((module) => ({ default: module.ModelHub })));
const Integrations = lazy(() => import('./components/IntegrationsHub.js').then((module) => ({ default: module.IntegrationsHub })));
const Pricing = lazy(() => import('./components/PricingPlans.js').then((module) => ({ default: module.PricingPlans })));

function Runtime({ initialRoomId }: { initialRoomId: string | null }) {
  useOfficeSimulation(initialRoomId);
  useSocketLifecycle();
  return null;
}

function closeOfficeDialogs() {
  const office = useWoraStore.getState();
  if (office.ui.showChat) office.toggleChat(false);
  if (office.ui.showWorkspaceHUD) office.toggleWorkspaceHUD(false);
  if (office.ui.showHireModal) office.setShowHireModal(false);
  if (office.ui.modelSwapAgentId) office.openModelSwap(null);
  if (office.ui.skillsAgentId) office.openAgentSkills(null);
}

export default function App() {
  const { t } = useI18n();
  const [hash, setHash] = useState(() => window.location.hash);
  const { page, roomId, tourIndex } = workspaceRoute(hash);
  const initialRoomId = useRef(roomId);
  const activeRoom = useWoraStore((state) => state.roomId);
  const [visitedDirector, setVisitedDirector] = useState(page === 'director');
  const [overlay, setOverlay] = useState<'menu' | 'help' | 'search' | null>(null);
  const main = useRef<HTMLElement>(null);
  const focusOnNavigate = useRef(false);

  const navigateHash = useCallback((target: string) => {
    setOverlay(null);
    closeOfficeDialogs();
    const current = window.location.hash;
    if (current === target || (!current && target === '#home')) return;
    if (workspaceRoute(current).page !== workspaceRoute(target).page) focusOnNavigate.current = true;
    window.history.pushState(null, '', target);
    setHash(target);
  }, []);
  const navigate = useCallback((target: PageId) => {
    if (target === 'campus' || target === 'director') useWoraStore.getState().resetCamera();
    navigateHash(`#${target}`);
  }, [navigateHash]);
  const visit = useCallback((id: string | null, tour = false) => {
    useWoraStore.getState().resetCamera();
    navigateHash(officeHash(id, tour));
  }, [navigateHash]);
  const toCampus = useCallback(() => navigate('campus'), [navigate]);
  const toDirector = useCallback(() => navigate('director'), [navigate]);
  const assign = useCallback(() => navigateHash('#director/task'), [navigateHash]);
  const launchCommand = useCallback((brief: string) => {
    void (async () => {
      try {
        await osApi.launchMission(brief);
        try { sessionStorage.removeItem('wora:os:launchError'); } catch { /* ignore */ }
      } catch (err) {
        try { sessionStorage.setItem('wora:os:launchError', err instanceof Error ? err.message : 'تعذر إطلاق المهمة.'); } catch { /* ignore */ }
      } finally {
        navigateHash('#execution');
      }
    })();
  }, [navigateHash]);
  const toPricing = useCallback(() => navigate('pricing'), [navigate]);
  const toProjects = useCallback(() => navigate('projects'), [navigate]);
  const toStudio = useCallback(() => navigate('studio'), [navigate]);
  const toIntegrations = useCallback(() => navigate('integrations'), [navigate]);
  const openAgent = useCallback((agentId: string) => {
    navigateHash('#campus');
    useWoraStore.getState().focusAgentCamera(agentId);
    main.current?.scrollTo({ top: 0 });
  }, [navigateHash]);

  useEffect(() => {
    if (page === 'director') {
      setVisitedDirector(true);
      useOfficeMotion.getState().visitRoom(DIRECTOR_ROOM_ID);
    }
  }, [page]);
  useEffect(() => {
    const routeChanged = (event: HashChangeEvent) => {
      if (workspaceRoute(new URL(event.oldURL).hash).page !== workspaceRoute(window.location.hash).page) focusOnNavigate.current = true;
      setOverlay(null);
      closeOfficeDialogs();
      useWoraStore.getState().resetCamera();
      setHash(window.location.hash);
    };
    const hotkey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      setOverlay('search');
    };
    const desktop = window.matchMedia('(min-width: 861px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => { if (event.matches) setOverlay((value) => value === 'menu' ? null : value); };
    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('keydown', hotkey);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('hashchange', routeChanged);
      window.removeEventListener('keydown', hotkey);
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, []);

  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
    if (focusOnNavigate.current) { main.current?.focus({ preventScroll: true }); focusOnNavigate.current = false; }
    document.title = `${t(`nav.${page}`)} — Wora`;
  }, [page, t]);

  return <div className="app-shell">
    <Runtime initialRoomId={initialRoomId.current} />
    <a href="#main-content" className="button primary skip-link" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>{t('app.skipToContent')}</a>
    <aside className="company-sidebar desktop-sidebar"><CompanySidebar page={page} onNavigate={navigate} onHelp={() => setOverlay('help')} /></aside>
    <div className="app-main">
      <CompanyHeader onMenu={() => setOverlay('menu')} onSearch={() => setOverlay('search')} onHome={() => navigate('home')} />
      <main id="main-content" className="app-scroll hq-scroll" tabIndex={-1} ref={main}>
        {page !== 'director' && <div className={`page-frame page-${page}`} key={page}>
          <WorkspacePage>
            {page === 'home' && <CommandCenter onNavigate={navigate} />}
            {page === 'campus' && <Campus roomId={roomId} tourIndex={tourIndex} onVisit={visit} onAssign={assign} onDirector={toDirector} />}
            {page === 'organizations' && <OrganizationsPage onNavigate={navigate} />}
            {page === 'workspaces' && <WorkspacesPage onNavigate={navigate} />}
            {page === 'projects' && <Projects onUpgrade={toPricing} onIntegrations={toIntegrations} />}
            {page === 'agents' && <Agents />}
            {page === 'execution' && <Execution />}
            {page === 'intelligence' && <Intelligence />}
            {page === 'extensions' && <Extensions />}
            {page === 'system' && <SystemConsole />}
            {page === 'studio' && <Studio onUpgrade={toPricing} onProjects={toProjects} />}
            {page === 'settings' && <WorkspaceSettings onNavigate={navigate} />}
            {page === 'models' && <Models onUpgrade={toPricing} />}
            {page === 'integrations' && <Integrations />}
            {page === 'pricing' && <Pricing onStudio={toStudio} />}
          </WorkspacePage>
        </div>}
        {(visitedDirector || page === 'director') && <div className="page-frame page-director" hidden={page !== 'director'}>
          <WorkspacePage loading="جارٍ تحميل مكتب المدير…">
            <Director key={activeRoom} focusInput={page === 'director' && hash === '#director/task'} onCampus={toCampus} onUpgrade={toPricing} />
          </WorkspacePage>
        </div>}
      </main>
      <ExecutiveCommandBar onSubmit={launchCommand} />
    </div>
    {overlay === 'menu' && <Dialog key="menu" title={t('nav.navigation')} variant="navigation" onClose={() => setOverlay(null)}><div className="company-sidebar"><CompanySidebar page={page} onNavigate={navigate} onHelp={() => setOverlay('help')} /></div></Dialog>}
    {overlay === 'search' && <QuickSearch onClose={() => setOverlay(null)} onNavigate={navigate} onAgent={openAgent} onRoom={visit} />}
    {overlay === 'help' && <Dialog key="help" icon={CircleHelp} title={t('help.title')} onClose={() => setOverlay(null)}>
      <div className="field-stack"><p>{t('help.body1')}</p><p>{t('help.body2')}</p><p>{t('help.body3')}</p></div>
    </Dialog>}
    <ChatDrawer />
    <WorkspaceBoard />
    <AgentSkillsDialog />
    <ModelSwapModal />
    <HireAgentModal onHired={openAgent} />
  </div>;
}
