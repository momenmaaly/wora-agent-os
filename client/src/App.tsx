import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleHelp, FolderKanban, Map, MessageCircle, Search } from 'lucide-react';
import { CompanyHeader } from './components/CompanyHeader.js';
import { CompanySidebar } from './components/CompanySidebar.js';
import { Campus, Dashboard } from './components/Dashboard.js';
import { HireAgentModal } from './components/HireAgentModal.js';
import { ModelSwapModal } from './components/ModelSwapModal.js';
import { ChatDrawer } from './components/ChatDrawer.js';
import { WorkspaceBoard } from './components/WorkspaceBoard.js';
import { QuickSearch } from './components/QuickSearch.js';
import { Dialog, IconTile } from './components/ui.js';
import { useSocketLifecycle } from './hooks/useSocket.js';
import { useOfficeSimulation } from './office/useOfficeSimulation.js';
import { currentPage, NAV_ITEMS, type PageId } from './pages.js';
import { useWoraStore } from './store/useWoraStore.js';

const Projects = lazy(() => import('./components/ProjectOSBoard.js').then((module) => ({ default: module.ProjectOSBoard })));
const Studio = lazy(() => import('./components/ProductStudio.js').then((module) => ({ default: module.ProductStudio })));
const Models = lazy(() => import('./components/ModelHub.js').then((module) => ({ default: module.ModelHub })));
const Integrations = lazy(() => import('./components/IntegrationsHub.js').then((module) => ({ default: module.IntegrationsHub })));
const Pricing = lazy(() => import('./components/PricingPlans.js').then((module) => ({ default: module.PricingPlans })));

function Runtime() {
  useSocketLifecycle();
  useOfficeSimulation();
  return null;
}

export default function App() {
  const [page, setPage] = useState<PageId>(currentPage);
  const [overlay, setOverlay] = useState<'menu' | 'help' | 'search' | null>(null);
  const main = useRef<HTMLElement>(null);
  const focusOnNavigate = useRef(false);
  const openHire = useWoraStore((s) => s.setShowHireModal);

  const navigate = useCallback((target: PageId) => {
    setOverlay(null);
    if (currentPage() === target) return;
    focusOnNavigate.current = true;
    window.history.pushState(null, '', `#${target}`);
    setPage(target);
  }, []);
  const toHome = useCallback(() => navigate('overview'), [navigate]);
  const toCampus = useCallback(() => navigate('campus'), [navigate]);
  const toPricing = useCallback(() => navigate('pricing'), [navigate]);
  const toProjects = useCallback(() => navigate('projects'), [navigate]);
  const toIntegrations = useCallback(() => navigate('integrations'), [navigate]);
  const toTeam = useCallback(() => {
    navigate('campus');
    window.requestAnimationFrame(() => {
      const section = document.getElementById('campus-team');
      section?.scrollIntoView({ block: 'nearest' });
      section?.focus({ preventScroll: true });
    });
  }, [navigate]);
  const openAgent = useCallback((agentId: string) => {
    navigate('campus');
    useWoraStore.getState().focusAgentCamera(agentId);
  }, [navigate]);

  useEffect(() => {
    const routeChanged = () => {
      setOverlay(null);
      const office = useWoraStore.getState();
      if (office.ui.showChat) office.toggleChat(false);
      if (office.ui.showWorkspaceHUD) office.toggleWorkspaceHUD(false);
      if (office.ui.showHireModal) office.setShowHireModal(false);
      if (office.ui.modelSwapAgentId) office.openModelSwap(null);
      setPage(currentPage());
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
    window.addEventListener('popstate', routeChanged);
    window.addEventListener('keydown', hotkey);
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      window.removeEventListener('hashchange', routeChanged);
      window.removeEventListener('popstate', routeChanged);
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
      <Runtime />
      <a href="#main-content" className="button primary skip-link" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>تخطَ إلى المحتوى</a>
      <aside className="company-sidebar desktop-sidebar"><CompanySidebar page={page} onNavigate={navigate} onHelp={() => setOverlay('help')} /></aside>
      <div className="app-main">
        <CompanyHeader page={page} onHome={toHome} onMenu={() => setOverlay('menu')} onSearch={() => setOverlay('search')} onHire={() => openHire(true)} />
        <main id="main-content" className="app-scroll hq-scroll" tabIndex={-1} ref={main}>
          <div className="page-frame" key={page}>
            <Suspense fallback={<div className="panel panel-pad subtle" role="status">جارٍ تحميل الصفحة…</div>}>
              {page === 'overview' && <Dashboard onCampus={toCampus} onTeam={toTeam} onProjects={toProjects} onAgent={openAgent} onUpgrade={toPricing} />}
              {page === 'campus' && <Campus onUpgrade={toPricing} />}
              {page === 'projects' && <Projects onUpgrade={toPricing} onIntegrations={toIntegrations} />}
              {page === 'studio' && <Studio onUpgrade={toPricing} onProjects={toProjects} />}
              {page === 'models' && <Models onUpgrade={toPricing} />}
              {page === 'integrations' && <Integrations />}
              {page === 'pricing' && <Pricing onStudio={() => navigate('studio')} />}
            </Suspense>
          </div>
        </main>
      </div>
      {overlay === 'menu' && <Dialog key="menu" title="مساحة عمل Wora" variant="navigation" onClose={() => setOverlay(null)}><div className="company-sidebar"><CompanySidebar page={page} onNavigate={navigate} onHelp={() => setOverlay('help')} /></div></Dialog>}
      {overlay === 'search' && <QuickSearch onClose={() => setOverlay(null)} onNavigate={navigate} onAgent={openAgent} />}
      {overlay === 'help' && <Dialog key="help" icon={CircleHelp} title="ابدأ في مقر Wora" description="ثلاث طرق للوصول لما تحتاجه بسرعة." onClose={() => setOverlay(null)}>
        <ul className="help-steps">
          <li><IconTile icon={Map} /><div><strong>تجوّل في المقر</strong>اختر قسماً من الخريطة، أو اختر وكيلاً لمتابعته أو إرساله إلى غرفة.</div></li>
          <li><IconTile icon={MessageCircle} /><div><strong>تواصل مع الفريق</strong>افتح المحادثة للتحدث مع الفريق أو اختر وكيلاً لمراسلته مباشرة.</div></li>
          <li><IconTile icon={FolderKanban} /><div><strong>نظّم العمل</strong>أنشئ مشروعاً أو وزّع المهام على الأقسام من لوحة المقر.</div></li>
          <li><IconTile icon={Search} /><div><strong>اختصر التنقل</strong>اضغط <kbd dir="ltr">Ctrl / ⌘ + K</kbd> للبحث عن صفحة، وكيل أو مشروع.</div></li>
        </ul>
      </Dialog>}
      <ChatDrawer />
      <WorkspaceBoard />
      <ModelSwapModal />
      <HireAgentModal onHired={openAgent} />
    </div>
  );
}
