import { useState } from 'react';
import { 
  Layers3, Rocket, Lightbulb, ShoppingBag, TrendingUp, Plus, 
  ChevronRight, Vote, Package, Kanban, Megaphone, BarChart3,
  Sparkles, Clock, User, Trash2, ArrowRight, Crown, Target
} from 'lucide-react';
import { useProjectStore, COLUMN_META } from '../store/useProjectStore.js';
import type { TaskColumn, Product, Idea, KanbanTask } from '../store/useProjectStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { OFFICE_ROOMS } from '../office/layout.js';
import { getModelById } from '../office/models.js';
import { PLANS } from '../billing/plans.js';
import { useBillingStore } from '../store/useBillingStore.js';

const STAGE_META: Record<string,{label:string; icon:string; color:string}> = {
  idea:     { label:'فكرة',     icon:'💡', color:'#f59e0b' },
  planning: { label:'تخطيط',    icon:'🗺️', color:'#4f46e5' },
  building: { label:'بناء',     icon:'🏗️', color:'#0284c7' },
  marketing:{ label:'تسويق',    icon:'📣', color:'#0891b2' },
  sales:    { label:'مبيعات',   icon:'🤝', color:'#7c3aed' },
  growth:   { label:'نمو',      icon:'🚀', color:'#059669' },
};

export function ProjectOSBoard() {
  const { projects, activeProjectId, products, ideas, tasks, setActiveProject, createProject, updateProjectStage, addProduct, addIdea, voteIdea, addTask, moveTask, deleteTask } = useProjectStore();
  const dispatchToRoom = useWoraStore(s=>s.dispatchAgentToRoom);
  const agents = useWoraStore(s=>s.agents);
  const [tab, setTab] = useState<'overview'|'kanban'|'products'|'ideas'|'marketing'>('overview');
  const [showNewProj, setShowNewProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newIdeaTitle, setNewIdeaTitle] = useState('');
  const [dragTask, setDragTask] = useState<string|null>(null);

  const activeProject = projects.find(p=>p.id===activeProjectId) ?? projects[0]!;
  const projProducts = products.filter(p=>p.projectId===activeProjectId);
  const projIdeas = ideas.filter(i=>i.projectId===activeProjectId);
  const projTasks = tasks.filter(t=>t.projectId===activeProjectId);

  const plan = useBillingStore(s=>s.plan);
  const limits = PLANS[plan].limits;
  const isPro = plan==='pro';
  const handleCreateProject = () => {
    if (!newProjName.trim()) return;
    if (projects.length >= limits.projects) { alert(`الخطة المجانية تسمح بـ ${limits.projects} مشاريع فقط — رقّ للـ Pro`); return; }
    createProject({ name: newProjName.trim(), description: newProjDesc.trim() || 'مشروع جديد', vision: 'نحو النجاح', stage: 'idea', color: '#4f46e5' });
    setNewProjName(''); setNewProjDesc(''); setShowNewProj(false);
  };

  const columnToRoom: Record<TaskColumn,string> = {
    ideas: 'zone-product', backlog: 'zone-planning', sprint: 'zone-engineering',
    design: 'zone-design', qa: 'zone-review', marketing: 'zone-marketing',
    launched: 'zone-sales', analytics: 'zone-analytics'
  };

  const handleMoveTask = (taskId: string, col: TaskColumn) => {
    moveTask(taskId, col);
    const task = tasks.find(t=>t.id===taskId);
    if (task?.assigneeId && columnToRoom[col]) {
      dispatchToRoom(task.assigneeId, columnToRoom[col], `مهمة انتقلت إلى ${COLUMN_META[col].labelAr}`);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      {/* Project Switcher Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex flex-1 items-center gap-2 overflow-x-auto hq-scroll">
          {projects.map(p=>{
            const active = p.id===activeProjectId;
            return (
              <button key={p.id} onClick={()=>setActiveProject(p.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900' : 'bg-card border-border hover:bg-muted'}`}>
                <span className="h-2 w-2 rounded-full" style={{background:p.color}}/>
                {p.name}
                <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px]">{p.stats.tasks} مهام</span>
              </button>
            );
          })}
          <button onClick={()=>setShowNewProj(!showNewProj)} className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-muted">
            <Plus className="h-3.5 w-3.5"/> مشروع جديد
          </button>
        </div>
      </div>

      {showNewProj && (
        <div className="border-b border-border bg-amber-50 px-3 py-3 dark:bg-amber-950/20">
          <div className="flex gap-2">
            <input value={newProjName} onChange={e=>setNewProjName(e.target.value)} placeholder="اسم المشروع — مثال: متجر إلكتروني للأزياء" className="h-9 flex-1 rounded-xl border border-border bg-white px-3 text-sm dark:bg-white/5"/>
            <input value={newProjDesc} onChange={e=>setNewProjDesc(e.target.value)} placeholder="وصف مختصر" className="hidden h-9 flex-1 rounded-xl border border-border bg-white px-3 text-sm dark:bg-white/5 sm:flex"/>
            <button onClick={handleCreateProject} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900">إنشاء</button>
          </div>
        </div>
      )}

      {/* Active Project Hero */}
      <div className="border-b border-border bg-gradient-to-l from-indigo-50/80 to-white px-4 py-3 dark:from-indigo-950/20 dark:to-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white text-sm" style={{background:activeProject.color}}>{STAGE_META[activeProject.stage]?.icon ?? '📁'}</span>
              <h3 className="truncate text-sm font-bold text-foreground">{activeProject.name}</h3>
              <span className="shrink-0 rounded-full border bg-card px-2 py-0.5 text-[11px] font-bold" style={{borderColor:activeProject.color, color:activeProject.color}}>{STAGE_META[activeProject.stage]?.label}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{activeProject.description} — {activeProject.vision}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['idea','planning','building','marketing','sales','growth'] as const).map(s=>{
                const active = activeProject.stage===s;
                const meta = STAGE_META[s]!;
                return (
                  <button key={s} onClick={()=>updateProjectStage(activeProject.id, s)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold transition ${active ? 'text-white border-transparent' : 'bg-card border-border hover:bg-muted'}`}
                    style={active ? {background:meta.color} : {}}>
                    <span>{meta.icon}</span> {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="hidden shrink-0 grid-cols-3 gap-2 sm:grid">
            {[
              {k:'products', v:activeProject.stats.products, icon:Package, label:'منتجات'},
              {k:'ideas', v:activeProject.stats.ideas, icon:Lightbulb, label:'أفكار'},
              {k:'tasks', v:activeProject.stats.tasks, icon:Kanban, label:'مهام'},
            ].map(s=>(
              <div key={s.k} className="flex flex-col items-center rounded-xl border border-border bg-card px-3 py-2">
                <s.icon className="h-4 w-4 text-muted-foreground"/>
                <span className="text-sm font-bold">{s.k==='products'?projProducts.length : s.k==='ideas'?projIdeas.length : projTasks.length}</span>
                <span className="text-[10px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!isPro && <div className="flex items-center justify-between bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/20">Free: {limits.products} منتجات · {limits.tasksPerProject} مهمة/مشروع · 8 نماذج مفتوحة — <span className="underline">Pro يفتح كل شيء</span><span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">Pro 🔒</span></div>}
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border bg-card px-2 py-1.5 overflow-x-auto hq-scroll">
        {[
          {id:'overview', label:'نظرة عامة', icon:Layers3},
          {id:'kanban', label:'لوحة المهام', icon:Kanban},
          {id:'products', label:'المنتجات', icon:ShoppingBag},
          {id:'ideas', label:'بنك الأفكار', icon:Lightbulb},
          {id:'marketing', label:'التسويق', icon:Megaphone},
        ].map(t=>{
          const active = tab===t.id;
          return (
            <button key={t.id} onClick={()=>setTab(t.id as typeof tab)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${active ? 'bg-indigo-600 text-white' : 'hover:bg-muted text-muted-foreground'}`}>
              <t.icon className="h-3.5 w-3.5"/> {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-muted/20 p-3 hq-scroll">
        {tab==='overview' && (
          <div className="grid gap-3">
            {/* Revenue + Pipeline */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><TrendingUp className="h-4 w-4 text-emerald-500"/> الإيراد</div>
                <div className="mt-2 text-xl font-bold">${activeProject.stats.revenue.toLocaleString()}</div>
                <div className="text-xs text-emerald-600">+12% هذا الشهر</div>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Package className="h-4 w-4 text-indigo-500"/> المنتجات المباعة</div>
                <div className="mt-2 text-xl font-bold">{projProducts.reduce((s,p)=>s+p.sold,0)}</div>
                <div className="text-xs text-muted-foreground">{projProducts.length} منتجات نشطة</div>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Target className="h-4 w-4 text-amber-500"/> معدل الإنجاز</div>
                <div className="mt-2 text-xl font-bold">{projTasks.length? Math.round(projTasks.filter(t=>t.column==='launched').length/projTasks.length*100):0}%</div>
                <div className="h-1.5 mt-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-indigo-600" style={{width:`${projTasks.length? Math.round(projTasks.filter(t=>t.column==='launched').length/projTasks.length*100):0}%`}}/></div>
              </div>
            </div>
            {/* Pipeline visual */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <h4 className="flex items-center gap-2 text-xs font-bold"><Rocket className="h-4 w-4 text-indigo-600"/> مسار المشروع: فكرة → تخطيط → بناء → تسويق → مبيعات → نمو</h4>
              <div className="mt-3 flex items-center gap-1 overflow-x-auto hq-scroll">
                {(Object.keys(COLUMN_META) as TaskColumn[]).map(col=>{
                  const count = projTasks.filter(t=>t.column===col).length;
                  const meta = COLUMN_META[col];
                  const room = OFFICE_ROOMS.find(r=> r.id===({ideas:'zone-product',backlog:'zone-planning',sprint:'zone-engineering',design:'zone-design',qa:'zone-review',marketing:'zone-marketing',launched:'zone-sales',analytics:'zone-analytics'} as Record<string,string>)[col]);
                  return (
                    <div key={col} className="flex flex-col items-center gap-1 shrink-0">
                      <div className="flex h-10 w-16 items-center justify-center rounded-xl text-lg" style={{background: (room?.accent ?? '#6366f1') + '18', border:`1px solid ${room?.accent ?? '#6366f1'}40`}}>{meta!.icon}</div>
                      <span className="text-[11px] font-bold">{meta!.labelAr}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">{count}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground last:hidden"/>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800 dark:bg-indigo-950/20 dark:text-indigo-300">
              <Sparkles className="h-4 w-4 inline mr-1"/> كل مرحلة يقودها قسم متخصص في المقر — اسحب المهام بين الأعمدة لتشاهد الوكلاء ينتقلون فعلياً عبر الممرات!
            </div>
          </div>
        )}

        {tab==='kanban' && (
          <div className="flex gap-3 overflow-x-auto pb-2 hq-scroll" style={{minHeight:340}}>
            {(Object.entries(COLUMN_META) as [TaskColumn, typeof COLUMN_META[TaskColumn]][]).map(([col, meta])=>{
              const colTasks = projTasks.filter(t=>t.column===col);
              return (
                <div key={col} onDragOver={e=>e.preventDefault()} onDrop={()=> dragTask && handleMoveTask(dragTask, col)}
                  className="flex w-[220px] shrink-0 flex-col rounded-2xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2" style={{borderTop:`3px solid ${meta.color}`, borderTopLeftRadius:16, borderTopRightRadius:16}}>
                    <span className="flex items-center gap-1.5 text-xs font-bold"><span>{meta.icon}</span> {meta.labelAr}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold">{colTasks.length}</span>
                  </div>
                  <div className="flex-1 space-y-2 p-2 overflow-y-auto hq-scroll">
                    {colTasks.map(t=>{
                      const assignee = agents[t.assigneeId];
                      const model = getModelById(t.modelId);
                      return (
                        <div key={t.id} draggable onDragStart={()=>setDragTask(t.id)} onDragEnd={()=>setDragTask(null)}
                          className="rounded-xl border border-border bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing dark:bg-white/5">
                          <div className="text-xs font-bold leading-snug">{t.title}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{t.description}</div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${t.priority==='urgent'?'bg-red-100 text-red-700': t.priority==='high'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>{t.priority}</span>
                            {assignee && <span className="flex items-center gap-1 text-[11px]"><span className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{background:assignee.profile.avatarColor}}>{assignee.displayName.slice(0,2)}</span> {assignee.displayName}</span>}
                          </div>
                          {model && <div className="mt-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground truncate">{model.displayName}</div>}
                          <div className="mt-2 flex justify-between">
                            <button onClick={()=>deleteTask(t.id)} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5"/></button>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3"/> {new Date(t.updatedAt).toLocaleDateString('ar-EG')}</span>
                          </div>
                        </div>
                      );
                    })}
                    <AddTaskMini projectId={activeProjectId} column={col} onAdd={addTask}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab==='products' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input value={newProductName} onChange={e=>setNewProductName(e.target.value)} placeholder="اسم المنتج الجديد" className="h-9 flex-1 rounded-xl border border-border bg-white px-3 text-sm dark:bg-white/5"/>
              <input value={newProductPrice} onChange={e=>setNewProductPrice(e.target.value)} placeholder="السعر $" type="number" className="h-9 w-24 rounded-xl border border-border bg-white px-3 text-sm dark:bg-white/5"/>
              <button onClick={()=>{ if(!newProductName.trim()||!newProductPrice) return; addProduct({ projectId:activeProjectId, name:newProductName.trim(), description:'منتج جديد', price:Number(newProductPrice), cost:Number(newProductPrice)*0.5, stock:50, image:'📦', category:'عام', status:'active' }); setNewProductName(''); setNewProductPrice(''); }} className="rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white">إضافة</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {projProducts.map(p=>(
                <div key={p.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-xl">{p.image}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.description}</div>
                      <div className="mt-1 flex gap-2 text-xs"><span className="font-bold text-emerald-600">${p.price}</span><span className="text-muted-foreground">تكلفة ${p.cost}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.status==='active'?'bg-emerald-100 text-emerald-700':'bg-slate-100'}`}>{p.status}</span></div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2 text-xs">
                    <span className="rounded-full bg-muted px-2 py-1">مخزون {p.stock}</span>
                    <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">مباع {p.sold}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">ربح ${ (p.price-p.cost)*p.sold }</span>
                  </div>
                </div>
              ))}
              {projProducts.length===0 && <div className="col-span-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">لا منتجات بعد — أضف أول منتج</div>}
            </div>
          </div>
        )}

        {tab==='ideas' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input value={newIdeaTitle} onChange={e=>setNewIdeaTitle(e.target.value)} placeholder="فكرة جديدة — مثال: اشتراك شهري بصندوق مفاجآت" className="h-9 flex-1 rounded-xl border border-border bg-white px-3 text-sm dark:bg-white/5"/>
              <button onClick={()=>{ if(!newIdeaTitle.trim()) return; addIdea({ projectId:activeProjectId, title:newIdeaTitle.trim(), description:'فكرة مقترحة', authorId:'agent-product-01' }); setNewIdeaTitle(''); }} className="rounded-xl bg-amber-500 px-4 text-xs font-bold text-white">إضافة فكرة</button>
            </div>
            <div className="grid gap-2">
              {projIdeas.sort((a,b)=>b.votes-a.votes).map(idea=>(
                <div key={idea.id} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
                  <button onClick={()=>voteIdea(idea.id)} className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-border bg-muted px-3 py-2 hover:bg-amber-50">
                    <Crown className="h-4 w-4 text-amber-500"/>
                    <span className="text-sm font-bold">{idea.votes}</span>
                    <span className="text-[10px]">صوّت</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold">{idea.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{idea.description}</div>
                    <div className="mt-1 flex gap-2 text-[11px]"><span className={`rounded-full px-2 py-0.5 font-bold ${idea.status==='approved'?'bg-emerald-100 text-emerald-700': idea.status==='implemented'?'bg-indigo-100 text-indigo-700':'bg-slate-100'}`}>{idea.status}</span><span className="text-muted-foreground">{new Date(idea.createdAt).toLocaleDateString('ar-EG')}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='marketing' && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h4 className="flex items-center gap-2 text-sm font-bold"><Megaphone className="h-4 w-4 text-cyan-600"/> قنوات التسويق</h4>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  {ch:'إنستغرام', icon:'📸', budget:'$800', reach:'12K'},
                  {ch:'تيك توك', icon:'🎵', budget:'$600', reach:'25K'},
                  {ch:'إعلانات جوجل', icon:'🔍', budget:'$900', reach:'8K'},
                  {ch:'بريد إلكتروني', icon:'✉️', budget:'$200', reach:'5K'},
                  {ch:'مؤثرين', icon:'🤳', budget:'$700', reach:'30K'},
                  {ch:'محتوى SEO', icon:'📝', budget:'$400', reach:'15K'},
                ].map(c=>(
                  <div key={c.ch} className="rounded-xl border border-border bg-muted/30 p-3 text-center">
                    <div className="text-lg">{c.icon}</div>
                    <div className="text-xs font-bold">{c.ch}</div>
                    <div className="text-[11px] text-muted-foreground">{c.budget} · {c.reach} وصول</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl bg-gradient-to-l from-cyan-500 to-indigo-600 p-3 text-white">
                <div className="text-xs font-bold">حملة الإطلاق القادمة</div>
                <div className="text-lg font-bold">خصم 20% لأول 100 عميل + شحن مجاني</div>
                <button className="mt-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700">إطلاق الحملة عبر Zayn</button>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-3">
              <div className="text-xs font-bold flex items-center gap-2"><BarChart3 className="h-4 w-4"/> أداء الحملات</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-lg font-bold">3.2%</div><div className="text-[11px] text-muted-foreground">معدل التحويل</div></div>
                <div><div className="text-lg font-bold">$4.2</div><div className="text-[11px] text-muted-foreground">تكلفة الاستحواذ</div></div>
                <div><div className="text-lg font-bold">4.8x</div><div className="text-[11px] text-muted-foreground">عائد الإنفاق</div></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddTaskMini({ projectId, column, onAdd }: { projectId:string; column: TaskColumn; onAdd: (t: Omit<KanbanTask,'id'|'createdAt'|'updatedAt'|'checklist'>)=>void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const agents = useWoraStore(s=>s.agents);
  const agentIds = Object.keys(agents);
  if (!open) return <button onClick={()=>setOpen(true)} className="w-full rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2 text-xs font-bold hover:bg-muted">+ مهمة</button>;
  return (
    <div className="rounded-xl border border-border bg-white p-2 dark:bg-white/5">
      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="عنوان المهمة" className="h-8 w-full rounded-lg border border-border bg-white px-2 text-xs dark:bg-white/5"/>
      <div className="mt-2 flex gap-1">
        <button onClick={()=>{ if(!title.trim()) return; onAdd({ projectId, title:title.trim(), description:'', column, priority:'medium', assigneeId: agentIds[0]!, department:'engineering', modelId:'claude-sonnet-4-5' }); setTitle(''); setOpen(false); }} className="flex-1 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">إضافة</button>
        <button onClick={()=>setOpen(false)} className="rounded-full border border-border px-3 py-1.5 text-xs">إلغاء</button>
      </div>
    </div>
  );
}
