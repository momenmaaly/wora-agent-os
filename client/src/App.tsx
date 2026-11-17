import { CompanyHeader } from './components/CompanyHeader.js';
import { CompanySidebar } from './components/CompanySidebar.js';
import { OfficeFloorplan } from './components/OfficeFloorplan.js';
import { ModelSwapModal } from './components/ModelSwapModal.js';
import { HireAgentModal } from './components/HireAgentModal.js';
import { ChatDrawer } from './components/ChatDrawer.js';
import { WorkspaceBoard } from './components/WorkspaceBoard.js';
import { useSocketLifecycle } from './hooks/useSocket.js';

function SocketBridge() {
  useSocketLifecycle();
  return null;
}

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <SocketBridge />
      <CompanyHeader />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar — desktop */}
        <div className="hidden shrink-0 md:flex">
          <CompanySidebar />
        </div>

        {/* Main HQ area */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <OfficeFloorplan />

          {/* Floating overlays */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-end gap-3 p-3">
            <div className="flex w-full flex-col items-end gap-3 sm:flex-row sm:justify-end">
              <WorkspaceBoard />
              <ChatDrawer />
            </div>
          </div>

          {/* Mobile sidebar as bottom sheet trigger already handled via header; show drawer on mobile when needed */}
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      <MobileSidebarSheet />

      {/* Global modals */}
      <ModelSwapModal />
      <HireAgentModal />
    </div>
  );
}

function MobileSidebarSheet() {
  const show = useWoraStoreMobile();
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40 flex md:hidden">
      <button
        aria-label="إغلاق"
        onClick={() => show.toggle()}
        className="flex-1 bg-slate-900/40 backdrop-blur-sm"
      />
      <div className="h-full w-[86vw] max-w-[340px] overflow-hidden bg-surface shadow-2xl">
        <CompanySidebar />
      </div>
    </div>
  );
}

// tiny hook to expose mobile sidebar state without importing whole store twice
import { useWoraStore } from './store/useWoraStore.js';
function useWoraStoreMobile() {
  const showSidebar  = useWoraStore((s) => s.ui.showSidebar);
  const toggleSidebar = useWoraStore((s) => s.toggleSidebar);
  // On mobile we treat showSidebar as drawer open; on desktop it's always side rail.
  // We need a way to detect mobile: we just expose the same state.
  // The desktop rail is hidden via CSS, so showing the sheet on mobile when showSidebar is true is correct.
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  // To avoid hydration flicker, we always return object; caller checks isMobile via CSS.
  // Simpler: if window is mobile and sidebar is open, show sheet.
  // We can't reliably know without media query, so we just check showSidebar and let CSS hide duplicate.
  // The sheet is hidden on md via `md:hidden` class, so it's safe.
  if (!showSidebar) return null;
  // Only actually render sheet on small screens — check via matchMedia
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) return null;
  } catch { /* ignore */ }
  return { toggle: toggleSidebar };
}
