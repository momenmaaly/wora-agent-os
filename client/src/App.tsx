import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleHelp, FolderKanban, Map, MessageCircle, Search } from 'lucide-react';
import { CompanyHeader } from './components/CompanyHeader.js';
import { CompanySidebar } from './components/CompanySidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { HireAgentModal } from './components/HireAgentModal.js';
import { ModelSwapModal } from './components/ModelSwapModal.js';
import { ChatDrawer } from './components/ChatDrawer.js';
import { WorkspaceBoard } from './components/WorkspaceBoard.js';
import { QuickSearch } from './components/QuickSearch.js';
import { Dialog, IconTile } from './components/ui.js';
import { useSocketLifecycle } from './hooks/useSocket.js';
import { useOfficeMotion, useOfficeSimulation } from './office/useOfficeSimulation.js';
import { officeHash, workspaceRoute, NAV_ITEMS, type PageId } from './pages.js';
import { useWoraStore } from './store/useWoraStore.js';

const Campus = lazy(() => import('./components/Campus.js').then((module) => ({ default: module.Campus })));
const Projects = lazy(() => import('./components/ProjectOSBoard.js').then((module) => ({ default: module.ProjectOSBoard })));
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
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const { page, roomId, tourIndex } = workspaceRoute(hash);
  const initialRoomId = useRef(roomId);
  const [showTeam, setShowTeam] = useState(false);
  const [overlay, setOverlay] = useState<'menu' | 'help' | 'search' | null>(null);
  const main = useRef<HTMLElement>(null);
  const focusOnNavigate = useRef(false);
  const openHire = useWoraStore((s) => s.setShowHireModal);

  const navigateHash = useCallback((target: string) => {
    setOverlay(null);
    setShowTeam(false);
    closeOfficeDialogs();
    const current = window.location.hash;
    if (current === target || (!current && target === '#overview')) return;
    if (workspaceRoute(current).page !== workspaceRoute(target).page) focusOnNavigate.current = true;
    window.history.pushState(null, '', target);
    setHash(target);
  }, []);
  const navigate = useCallback((target: PageId) => {
    if (target === 'overview') {
      useWoraStore.getState().resetCamera();
      useOfficeMotion.getState().visitRoom(null);
    }
    navigateHash(`#${target}`);
  }, [navigateHash]);
  const visit = useCallback((id: string | null, tour = false) => {
    useWoraStore.getState().resetCamera();
    navigateHash(officeHash(id, tour));
  }, [navigateHash]);
  const startTour = useCallback(() => visit(null, true), [visit]);
  const searchVisit = useCallback((id: string) => {
    visit(id);
    if (page === 'campus') window.requestAnimationFrame(() => {
      main.current?.scrollTo({ top: 0 });
      main.current?.focus({ preventScroll: true });
    });
  }, [page, visit]);
  const toHome = useCallback(() => navigate('overview'), [navigate]);
  const toCampus = useCallback(() => navigate('campus'), [navigate]);
  const toPricing = useCallback(() => navigate('pricing'), [navigate]);
  const toProjects = useCallback(() => navigate('projects'), [navigate]);
  const toStudio = useCallback(() => navigate('studio'), [navigate]);
  const toIntegrations = useCallback(() => navigate('integrations'), [navigate]);
  const toTeam = useCallback(() => {
    navigate('campus');
    setShowTeam(true);
  }, [navigate]);
  const clearTeamJump = useCallback(() => setShowTeam(false), []);
  const openAgent = useCallback((agentId: string) => {
    navigate('campus');
    useWoraStore.getState().focusAgentCamera(agentId);
  }, [navigate]);

  useEffect(() => {
    const routeChanged = () => {
      setOverlay(null);
      setShowTeam(false);
      closeOfficeDialogs();
      const route = workspaceRoute(window.location.hash);
      useWoraStore.getState().resetCamera();
      if (route.page === 'overview') useOfficeMotion.getState().visitRoom(null);
      setHash(window.location.hash);
    };
    const hotkey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('dialog[open]')) return;
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
    document.title = `${NAV_ITEMS.find((item) => item.id === page)?.label ?? 'مساحة العمل'} — Wora`;
  }, [page]);

  return (
    <div className="app-shell">
      <Runtime initialRoomId={initialRoomId.current} />
      <a href="#main-content" className="button primary skip-link" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>تخطَ إلى المحتوى</a>
      <aside className="company-sidebar desktop-sidebar"><CompanySidebar page={page} onNavigate={navigate} onHelp={() => setOverlay('help')} /></aside>
      <div className="app-main">
        <CompanyHeader page={page} onHome={toHome} onMenu={() => setOverlay('menu')} onSearch={() => setOverlay('search')} onHire={() => openHire(true)} />
        <main id="main-content" className="app-scroll hq-scroll" tabIndex={-1} ref={main}>
          <div className="page-frame" key={page}>
            <Suspense fallback={<div className="panel panel-pad subtle" role="status">جارٍ تحميل الصفحة…</div>}>
              {page === 'overview' && <Dashboard onCampus={toCampus} onTour={startTour} onVisit={visit} onTeam={toTeam} onProjects={toProjects} onAgent={openAgent} />}
              {page === 'campus' && <Campus roomId={roomId} tourIndex={tourIndex} onVisit={visit} onReception={toHome} onUpgrade={toPricing} onWorkArea={navigate} showTeam={showTeam} onTeamShown={clearTeamJump} />}
              {page === 'projects' && <Projects onUpgrade={toPricing} onIntegrations={toIntegrations} />}
              {page === 'studio' && <Studio onUpgrade={toPricing} onProjects={toProjects} />}
              {page === 'models' && <Models onUpgrade={toPricing} />}
              {page === 'integrations' && <Integrations />}
              {page === 'pricing' && <Pricing onStudio={toStudio} />}
            </Suspense>
          </div>
        </main>
      </div>
      {overlay === 'menu' && <Dialog key="menu" title="مساحة عمل Wora" variant="navigation" onClose={() => setOverlay(null)}><div className="company-sidebar"><CompanySidebar page={page} onNavigate={navigate} onHelp={() => setOverlay('help')} /></div></Dialog>}
      {overlay === 'search' && <QuickSearch onClose={() => setOverlay(null)} onNavigate={navigate} onAgent={openAgent} onRoom={searchVisit} />}
      {overlay === 'help' && <Dialog key="help" icon={CircleHelp} title="ابدأ في مقر Wora" description="نصائح للتجوّل والعمل داخل المقر." onClose={() => setOverlay(null)}>
        <ul className="help-steps">
          <li><IconTile icon={Map} /><div><strong>تجوّل في المقر</strong>ابدأ من الاستقبال واختر قسماً لتمشي إليه، أو جرّب الجولة الإرشادية بين الأقسام العشرة.</div></li>
          <li><IconTile icon={MessageCircle} /><div><strong>تواصل مع الفريق</strong>افتح المحادثة للتحدث مع الفريق أو اختر وكيلاً لمراسلته مباشرة.</div></li>
          <li><IconTile icon={FolderKanban} /><div><strong>نظّم العمل</strong>أنشئ مشروعاً أو وزّع المهام على الأقسام من لوحة المقر.</div></li>
          <li><IconTile icon={Search} /><div><strong>اختصر التنقل</strong>اضغط <kbd dir="ltr">Ctrl / ⌘ + K</kbd> للبحث عن قسم، وكيل أو مشروع.</div></li>
        </ul>
      </Dialog>}
      <ChatDrawer />
      <WorkspaceBoard />
      <ModelSwapModal />
      <HireAgentModal onHired={openAgent} />
    </div>
  );
}
