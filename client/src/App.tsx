import { useState } from 'react';
import { CompanyHeader } from './components/CompanyHeader.js';
import { CompanySidebar } from './components/CompanySidebar.js';
import { OfficeFloorplan } from './components/OfficeFloorplan.js';
import { ModelSwapModal } from './components/ModelSwapModal.js';
import { HireAgentModal } from './components/HireAgentModal.js';
import { ChatDrawer } from './components/ChatDrawer.js';
import { WorkspaceBoard } from './components/WorkspaceBoard.js';
import { ProjectOSBoard } from './components/ProjectOSBoard.js';
import { ModelHub } from './components/ModelHub.js';
import { useSocketLifecycle } from './hooks/useSocket.js';
import { useWoraStore } from './store/useWoraStore.js';
import { Layers3, Cpu, Building2, MessageCircle, ClipboardList } from 'lucide-react';

function SocketBridge(){ useSocketLifecycle(); return null; }

type MainTab = 'campus'|'projects'|'models';

export default function App(){
  const [mainTab, setMainTab] = useState<MainTab>('campus');

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <SocketBridge/>
      <CompanyHeader/>

      {/* Main tab switcher */}
      <div className="flex items-center gap-1 border-b border-border bg-card px-2 py-1.5">
        {[
          {id:'campus', label:'المقر الحي', icon:Building2},
          {id:'projects', label:'نظام المشاريع', icon:Layers3},
          {id:'models', label:'كتالوج النماذج', icon:Cpu},
        ].map(t=>{
          const active = mainTab===t.id;
          return (
            <button key={t.id} onClick={()=>setMainTab(t.id as MainTab)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${active?'bg-slate-900 text-white dark:bg-white dark:text-slate-900':'hover:bg-muted text-muted-foreground'}`}>
              <t.icon className="h-4 w-4"/> {t.label}
            </button>
          );
        })}
        <div className="ml-auto hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"/> 10 غرف · 32 نموذج · 11 وكيل · pipeline كامل
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="hidden shrink-0 md:flex"><CompanySidebar/></div>
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {mainTab==='campus' && (
            <>
              <OfficeFloorplan/>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-end gap-3 p-3">
                <div className="flex w-full flex-col items-end gap-3 sm:flex-row sm:justify-end">
                  <WorkspaceBoard/>
                  <ChatDrawer/>
                </div>
              </div>
            </>
          )}
          {mainTab==='projects' && (
            <div className="flex-1 overflow-hidden bg-muted/20 p-3">
              <ProjectOSBoard/>
            </div>
          )}
          {mainTab==='models' && (
            <div className="flex-1 overflow-hidden bg-muted/20 p-3">
              <ModelHub/>
            </div>
          )}
        </div>
      </div>
      <MobileSidebarSheet/>
      <ModelSwapModal/>
      <HireAgentModal/>
    </div>
  );
}

function MobileSidebarSheet(){
  const show = useWoraStoreMobile();
  if(!show) return null;
  return (
    <div className="fixed inset-0 z-40 flex md:hidden">
      <button aria-label="إغلاق" onClick={()=>show.toggle()} className="flex-1 bg-slate-900/40 backdrop-blur-sm"/>
      <div className="h-full w-[86vw] max-w-[340px] overflow-hidden bg-surface shadow-2xl"><CompanySidebar/></div>
    </div>
  );
}
function useWoraStoreMobile(){
  const showSidebar = useWoraStore(s=>s.ui.showSidebar);
  const toggleSidebar = useWoraStore(s=>s.toggleSidebar);
  if(!showSidebar) return null;
  try{ if(typeof window!=='undefined' && window.matchMedia('(min-width: 768px)').matches) return null; }catch{}
  return { toggle: toggleSidebar };
}
