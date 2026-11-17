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
import { ProductStudio } from './components/ProductStudio.js';
import { PricingPlans } from './components/PricingPlans.js';
import { IntegrationsHub } from './components/IntegrationsHub.js';
import { useSocketLifecycle } from './hooks/useSocket.js';
import { useWoraStore } from './store/useWoraStore.js';
import { Building2, Layers3, Cpu, Sparkles, BadgeDollarSign, Plug2 } from 'lucide-react';

function SocketBridge(){ useSocketLifecycle(); return null; }
type MainTab = 'campus'|'studio'|'projects'|'models'|'integrations'|'pricing';
const TABS: {id:MainTab; label:string; icon:typeof Building2; badge?:string}[] = [
  {id:'campus', label:'المقر الحي', icon:Building2},
  {id:'studio', label:'استوديو المنتج', icon:Sparkles, badge:'Pro'},
  {id:'projects', label:'المشاريع', icon:Layers3},
  {id:'models', label:'النماذج', icon:Cpu},
  {id:'integrations', label:'التكاملات', icon:Plug2},
  {id:'pricing', label:'الخطط', icon:BadgeDollarSign},
];

export default function App(){
  const [mainTab, setMainTab] = useState<MainTab>('campus');
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[hsl(var(--background))] text-foreground">
      <SocketBridge/>
      <CompanyHeader/>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-stone-200 bg-white px-2 py-2 hq-scroll dark:bg-[#0B0F19] dark:border-white/10">
        {TABS.map(t=>{
          const active = mainTab===t.id;
          return (
            <button key={t.id} onClick={()=>setMainTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${active ? 'bg-[#0B0F19] text-white dark:bg-white dark:text-slate-900 shadow' : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10'}`}>
              <t.icon className="h-4 w-4"/> {t.label} {t.badge && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${active ? 'bg-[#CBA36B] text-[#0B0F19]' : 'bg-amber-100 text-amber-800'}`}>{t.badge}</span>}
            </button>
          );
        })}
        <div className="ml-auto hidden items-center gap-2 text-[11px] text-stone-500 sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"/> كل قسم وتكامله — GitHub, Figma, Meta, WhatsApp, Stripe
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
                  <WorkspaceBoard/><ChatDrawer/>
                </div>
              </div>
            </>
          )}
          {mainTab==='studio' && <div className="flex-1 overflow-y-auto bg-[#FDFBF7] p-4 hq-scroll dark:bg-[#0B0F19]"><ProductStudio onUpgrade={()=>setMainTab('pricing')}/></div>}
          {mainTab==='projects' && <div className="flex-1 overflow-hidden bg-stone-50 p-3 dark:bg-[#0B0F19]"><ProjectOSBoard/></div>}
          {mainTab==='models' && <div className="flex-1 overflow-hidden bg-stone-50 p-3 dark:bg-[#0B0F19]"><ModelHub/></div>}
          {mainTab==='integrations' && <div className="flex-1 overflow-y-auto bg-stone-50 p-3 hq-scroll dark:bg-[#0B0F19]"><IntegrationsHub/></div>}
          {mainTab==='pricing' && <div className="flex-1 overflow-y-auto bg-[#FDFBF7] p-6 hq-scroll dark:bg-[#0B0F19]"><PricingPlans/></div>}
        </div>
      </div>
      <MobileSidebarSheet/>
      <ModelSwapModal/><HireAgentModal/>
    </div>
  );
}
function MobileSidebarSheet(){
  const show = useWoraStoreMobile();
  if(!show) return null;
  return (
    <div className="fixed inset-0 z-40 flex md:hidden">
      <button aria-label="إغلاق" onClick={()=>show.toggle()} className="flex-1 bg-slate-900/40 backdrop-blur-sm"/>
      <div className="h-full w-[86vw] max-w-[340px] overflow-hidden bg-white shadow-2xl"><CompanySidebar/></div>
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
