import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUp, ClipboardList, FolderKanban, Layers3, LayoutGrid, Lightbulb, Megaphone, Package, Plus, Trash2, TrendingUp } from 'lucide-react';
import { useProjectStore, COLUMN_META, type KanbanTask, type ProjectStage, type TaskColumn } from '../store/useProjectStore.js';
import { useWoraStore } from '../store/useWoraStore.js';
import { useBillingStore } from '../store/useBillingStore.js';
import { isRoomLockedForPlan, PLANS } from '../billing/plans.js';
import { orderedAgents } from '../office/presentation.js';
import { AgentAvatar } from './OfficePeople.js';
import { Dialog, EmptyState, IconButton, IconTile, Notice, PageHeader } from './ui.js';

const STAGE_META: Record<ProjectStage, string> = { idea: 'فكرة', planning: 'تخطيط', building: 'بناء', marketing: 'تسويق', sales: 'مبيعات', growth: 'نمو' };
const COLUMN_ROOMS: Record<TaskColumn, string> = {
  ideas: 'zone-product', backlog: 'zone-planning', sprint: 'zone-engineering', design: 'zone-design', qa: 'zone-review', marketing: 'zone-marketing', launched: 'zone-sales', analytics: 'zone-analytics',
};
const PRIORITY_META = { low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', urgent: 'عاجلة' } as const;
const IDEA_STATUS = { open: 'مفتوحة', approved: 'معتمدة', rejected: 'مرفوضة', implemented: 'منفذة' } as const;
const PRODUCT_STATUS = { draft: 'مسودة', active: 'نشط', sold_out: 'نفد المخزون', archived: 'مؤرشف' } as const;
const COLUMNS = Object.keys(COLUMN_META) as TaskColumn[];
const TABS = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutGrid }, { id: 'kanban', label: 'لوحة المهام', icon: ClipboardList },
  { id: 'products', label: 'المنتجات', icon: Package }, { id: 'ideas', label: 'بنك الأفكار', icon: Lightbulb }, { id: 'marketing', label: 'التسويق', icon: Megaphone },
] as const;
type Tab = (typeof TABS)[number]['id'];
type Editor = { kind: 'project' | 'task' | 'product' | 'idea'; column?: TaskColumn };
const EDITOR_LABEL = { project: 'مشروع جديد', task: 'مهمة جديدة', product: 'منتج جديد', idea: 'فكرة جديدة' } as const;
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export function ProjectOSBoard({ onUpgrade, onIntegrations }: { onUpgrade: () => void; onIntegrations: () => void }) {
  const store = useProjectStore();
  const plan = useBillingStore((s) => s.plan);
  const agentMap = useWoraStore((s) => s.agents);
  const dispatch = useWoraStore((s) => s.dispatchAgentToRoom);
  const [tab, setTab] = useState<Tab>('overview');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleteTask, setDeleteTask] = useState<KanbanTask | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const project = store.projects.find((item) => item.id === store.activeProjectId) ?? store.projects[0];
  const products = store.products.filter((item) => item.projectId === project?.id);
  const ideas = store.ideas.filter((item) => item.projectId === project?.id).sort((a, b) => b.votes - a.votes);
  const tasks = store.tasks.filter((item) => item.projectId === project?.id);
  const limits = PLANS[plan].limits;
  const limitReached = { project: store.projects.length >= limits.projects, product: store.products.length >= limits.products, idea: store.ideas.length >= limits.ideas, task: tasks.length >= limits.tasksPerProject };

  function moveTask(id: string, column: TaskColumn) {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.column === column) return;
    store.moveTask(id, column);
    if (task.assigneeId && !isRoomLockedForPlan(COLUMN_ROOMS[column], plan)) dispatch(task.assigneeId, COLUMN_ROOMS[column], `انتقلت المهمة إلى ${COLUMN_META[column].labelAr}`);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || limitReached[editor.kind]) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '').trim();
    const description = String(data.get('description') ?? '').trim();
    if (!title) return;
    if (editor.kind === 'project') {
      store.createProject({ name: title, description, vision: '', color: '#8b70e8', stage: 'idea' });
      setTab('overview');
    } else if (project && editor.kind === 'task') {
      const column = data.get('column') as TaskColumn;
      const agent = agentMap[String(data.get('agent') ?? '')];
      store.addTask({ projectId: project.id, title, description, column, priority: data.get('priority') as KanbanTask['priority'], assigneeId: agent?.id ?? '', department: COLUMN_ROOMS[column], modelId: agent?.brainConfig?.model ?? agent?.modelId ?? '' });
      if (agent && !isRoomLockedForPlan(COLUMN_ROOMS[column], plan)) dispatch(agent.id, COLUMN_ROOMS[column], `مهمة جديدة: ${title}`);
    } else if (project && editor.kind === 'product') {
      const price = Number(data.get('price'));
      if (!Number.isFinite(price) || price < 0) return;
      store.addProduct({ projectId: project.id, name: title, description, price, cost: 0, stock: Number(data.get('stock')), image: '📦', category: 'عام', status: 'draft' });
    } else if (project && editor.kind === 'idea') {
      store.addIdea({ projectId: project.id, title, description, authorId: useWoraStore.getState().localUserId });
    }
    setEditor(null);
  }

  function sectionTitle(title: string, text: string, kind: Editor['kind']) {
    return <div className="section-bar"><div><h2>{title}</h2><p>{text}</p></div><button type="button" className="button small" onClick={() => setEditor({ kind })}><Plus size={16} />{EDITOR_LABEL[kind]}</button></div>;
  }

  return (
    <>
      <PageHeader icon={FolderKanban} eyebrow="تنظيم العمل" title="المشاريع" description="نظّم كل مشروع من الفكرة الأولى إلى الإطلاق، وتابع المهام والمنتجات في مكان واحد."
        action={<button type="button" className="button primary" onClick={() => setEditor({ kind: 'project' })}><Plus size={18} />مشروع جديد</button>} />
      {project ? <>
        <div className="filter-row project-switcher" aria-label="اختيار المشروع">
          {store.projects.map((item) => <button type="button" className="filter-chip" key={item.id} aria-pressed={item.id === project.id} onClick={() => { store.setActiveProject(item.id); setTab('overview'); }}>
            <span className="project-dot" style={{ background: item.color }} />{item.name}
          </button>)}
        </div>
        <section className="panel project-banner panel-pad">
          <div className="project-banner-title"><IconTile icon={Layers3} /><div><h2>{project.name}</h2><p>{project.description || 'لا يوجد وصف لهذا المشروع بعد.'}</p></div></div>
          <label className="label">مرحلة المشروع<select className="field" value={project.stage} onChange={(event) => store.updateProjectStage(project.id, event.target.value as ProjectStage)}>
            {Object.entries(STAGE_META).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
        </section>
        <div className="panel project-content">
          <nav className="project-tabs hq-scroll" aria-label="أقسام المشروع">
            {TABS.map((item) => <button key={item.id} type="button" className="filter-chip" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}><item.icon size={15} />{item.label}</button>)}
          </nav>
          <div className="project-section panel-pad" key={`${project.id}-${tab}`}>
            {tab === 'overview' && <>
              <div className="summary-grid">
                {([{ icon: ClipboardList, label: 'المهام', value: tasks.length, tab: 'kanban' }, { icon: Package, label: 'المنتجات', value: products.length, tab: 'products' }, { icon: Lightbulb, label: 'الأفكار', value: ideas.length, tab: 'ideas' }] as const).map((item) =>
                  <button key={item.label} type="button" className="summary-cell" onClick={() => setTab(item.tab)}><IconTile icon={item.icon} /><span>{item.label}<strong>{item.value}</strong></span><ArrowLeft size={16} /></button>)}
                <div className="summary-cell"><IconTile icon={TrendingUp} tone="mint" /><span>المبيعات المسجلة<strong><bdi>{USD.format(products.reduce((total, item) => total + item.price * item.sold, 0))}</bdi></strong></span></div>
              </div>
              {project.vision && <div className="project-vision"><small>رؤية المشروع</small><p>{project.vision}</p></div>}
              <div className="section-bar"><div><h2>آخر المهام</h2><p>آخر ما تغيّر في لوحة المشروع.</p></div><button type="button" className="text-link" onClick={() => setTab('kanban')}>عرض اللوحة <ArrowLeft size={15} /></button></div>
              {tasks.length ? <ul className="feature-list">{[...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4).map((item) => <li key={item.id}><ClipboardList size={17} /><span>{item.title}</span><small className="badge">{COLUMN_META[item.column].labelAr}</small></li>)}</ul> : <EmptyState icon={ClipboardList} title="لا توجد مهام بعد"><button type="button" className="text-link" onClick={() => setEditor({ kind: 'task' })}>أضف مهمة لبدء العمل <ArrowLeft size={15} /></button></EmptyState>}
            </>}
            {tab === 'kanban' && <>
              {sectionTitle('لوحة المهام', 'اسحب المهمة بين المراحل أو غيّر المرحلة من داخل البطاقة.', 'task')}
              <div className="kanban-lanes hq-scroll" aria-label="مراحل المهام">
                {COLUMNS.map((column) => <section key={column} className="kanban-lane" onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={(event) => {
                  if (!dragging) return;
                  event.preventDefault(); moveTask(dragging, column); setDragging(null);
                }}>
                  <h3><span className="project-dot" style={{ background: COLUMN_META[column].color }} />{COLUMN_META[column].labelAr}<span className="badge">{tasks.filter((item) => item.column === column).length}</span></h3>
                  {tasks.filter((item) => item.column === column).map((task) => <article key={task.id} className="kanban-task" draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setDragging(task.id); }} onDragEnd={() => setDragging(null)}>
                    <div className="kanban-title"><strong dir="auto">{task.title}</strong><IconButton icon={Trash2} className="task-delete" label={`حذف ${task.title}`} onClick={() => setDeleteTask(task)} /></div>
                    {task.description && <p dir="auto">{task.description}</p>}
                    <div className="kanban-meta">{agentMap[task.assigneeId] && <><AgentAvatar agent={agentMap[task.assigneeId]!} /><bdi>{agentMap[task.assigneeId]?.displayName}</bdi></>}<span className={`badge ${task.priority === 'urgent' || task.priority === 'high' ? 'tint tone-gold' : ''}`}>{PRIORITY_META[task.priority]}</span></div>
                    <select className="field" value={task.column} aria-label={`مرحلة ${task.title}`} onChange={(event) => moveTask(task.id, event.target.value as TaskColumn)}>{COLUMNS.map((item) => <option value={item} key={item}>{COLUMN_META[item].labelAr}</option>)}</select>
                  </article>)}
                  <button type="button" className="filter-chip kanban-add" onClick={() => setEditor({ kind: 'task', column })}><Plus size={14} />إضافة مهمة</button>
                </section>)}
              </div>
            </>}
            {tab === 'products' && <>
              {sectionTitle('منتجات المشروع', 'تابع السعر والمخزون والمسودات المحفوظة في هذا المشروع.', 'product')}
              {products.length ? <div className="catalog-grid">{products.map((item) => <article key={item.id} className="catalog-card">
                <div className="catalog-head"><IconTile icon={Package} /><div><h3>{item.name}</h3><p>{item.description || item.category}</p></div></div>
                <div className="product-facts"><strong dir="ltr">{USD.format(item.price)}</strong><span>المخزون: {item.stock}</span><span>مباع: {item.sold}</span></div>
                <label className="label">حالة المنتج<select className="field" value={item.status} onChange={(event) => store.updateProduct(item.id, { status: event.target.value as typeof item.status })}>{Object.entries(PRODUCT_STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              </article>)}</div> : <EmptyState icon={Package} title="لا توجد منتجات بعد">أضف منتجاً من هنا أو احفظ مسودة من استوديو المنتج.</EmptyState>}
            </>}
            {tab === 'ideas' && <>
              {sectionTitle('بنك الأفكار', 'احفظ الأفكار وصوّت للمقترحات التي تستحق الأولوية.', 'idea')}
              {ideas.length ? <ul className="idea-list">{ideas.map((item) => <li className="catalog-card idea-card" key={item.id}>
                <button className="button vote-button" type="button" aria-label={`التصويت لفكرة ${item.title}`} onClick={() => store.voteIdea(item.id)}><ArrowUp size={15} />{item.votes}</button>
                <div><h3>{item.title}</h3><p>{item.description || 'فكرة مقترحة'}</p></div><span className="badge">{IDEA_STATUS[item.status]}</span>
              </li>)}</ul> : <EmptyState icon={Lightbulb} title="بنك الأفكار فارغ">أضف أول فكرة وابدأ تطويرها.</EmptyState>}
            </>}
            {tab === 'marketing' && <>
              <div className="section-bar"><div><h2>أعمال التسويق</h2><p>خطّط للحملة هنا. النشر على المنصات الخارجية غير مفعّل في المعاينة.</p></div><button type="button" className="button small" onClick={onIntegrations}>استعرض التكاملات <ArrowLeft size={15} /></button></div>
              {tasks.some((item) => item.column === 'marketing') ? <ul className="feature-list">{tasks.filter((item) => item.column === 'marketing').map((item) => <li key={item.id}><Megaphone size={17} /><span>{item.title}</span><small className="badge">{PRIORITY_META[item.priority]}</small></li>)}</ul> : <EmptyState icon={Megaphone} title="لا توجد مهام تسويقية">أضف مسودة حملة كأول مهمة للفريق.</EmptyState>}
              <button type="button" className="button" onClick={() => setEditor({ kind: 'task', column: 'marketing' })}><Plus size={16} />إضافة مهمة تسويقية</button>
            </>}
          </div>
        </div>
      </> : <EmptyState icon={FolderKanban} title="ابدأ بمشروع جديد">أضف أول مشروع لتنظيم أفكارك ومهامك.</EmptyState>}
      {editor && <Dialog key={editor.kind} icon={Plus} title={EDITOR_LABEL[editor.kind]} onClose={() => setEditor(null)} footer={<>
        <button type="button" className="button ghost" onClick={() => setEditor(null)}>إلغاء</button>
        {limitReached[editor.kind] ? <button type="button" className="button primary" onClick={() => { setEditor(null); onUpgrade(); }}>عرض الخطط</button> : <button type="submit" form="project-editor" className="button primary">حفظ</button>}
      </>}>
        {limitReached[editor.kind] ? <Notice>وصلت للحد المسموح به في خطتك الحالية. يمكنك تغيير الخطة من صفحة الخطط.</Notice> : <form className="field-stack" id="project-editor" onSubmit={save}>
          <label className="label">الاسم أو العنوان<input data-initial-focus className="field" name="title" required maxLength={140} dir="auto" placeholder={EDITOR_LABEL[editor.kind]} /></label>
          <label className="label">وصف مختصر<textarea className="field" name="description" maxLength={900} dir="auto" rows={2} /></label>
          {editor.kind === 'task' && <>
            <div className="field-grid"><label className="label">المرحلة<select name="column" className="field" defaultValue={editor.column ?? 'backlog'}>{COLUMNS.map((item) => <option value={item} key={item}>{COLUMN_META[item].labelAr}</option>)}</select></label>
              <label className="label">الأولوية<select name="priority" className="field" defaultValue="medium">{Object.entries(PRIORITY_META).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
            <label className="label">الوكيل المسؤول<select name="agent" className="field"><option value="">غير مسندة</option>{orderedAgents(agentMap).map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}</select></label>
          </>}
          {editor.kind === 'product' && <div className="field-grid"><label className="label">السعر بالدولار<input className="field" name="price" type="number" min={0} max={1_000_000} step="0.01" required /></label><label className="label">المخزون<input className="field" name="stock" type="number" min={0} max={1_000_000} defaultValue="0" required /></label></div>}
        </form>}
      </Dialog>}
      {deleteTask && <Dialog icon={Trash2} title="حذف المهمة؟" description={deleteTask.title} onClose={() => setDeleteTask(null)} footer={<><button type="button" className="button ghost" onClick={() => setDeleteTask(null)}>إلغاء</button><button type="button" className="button danger" onClick={() => { store.deleteTask(deleteTask.id); setDeleteTask(null); }}>حذف المهمة</button></>}>ستُزال المهمة من لوحة المشروع.</Dialog>}
    </>
  );
}
