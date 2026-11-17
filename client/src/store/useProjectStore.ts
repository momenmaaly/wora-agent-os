/**
 * useProjectStore.ts — Wora Project OS v6.0
 * دورة حياة كاملة: فكرة → منتج → تسويق → مبيعات → تحليل
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudioDraft } from '../studio/drafts.js';

export type ProjectStage = 'idea'|'planning'|'building'|'marketing'|'sales'|'growth';
export type TaskColumn = 'ideas'|'backlog'|'sprint'|'design'|'qa'|'marketing'|'launched'|'analytics';
export type ProductStatus = 'draft'|'active'|'sold_out'|'archived';

export interface Project {
  id: string; name: string; description: string; vision: string;
  stage: ProjectStage; color: string;
  createdAt: string; updatedAt: string;
  stats: { products:number; ideas:number; tasks:number; revenue:number };
}
export interface Product {
  id: string; projectId: string; name: string; description: string;
  price: number; cost: number; stock: number; sold: number;
  image: string; category: string; status: ProductStatus; createdAt: string;
  studioRef?: { sessionId: string; index: number };
}

export function studioSaveState(draft: StudioDraft, product?: Product) {
  if (!product) return 'new';
  if (product.status !== 'draft') return 'managed';
  const unchanged = draft.name === product.name && draft.description === product.description && draft.category === product.category && draft.price === product.price && draft.cost === product.cost;
  return unchanged ? 'saved' : 'changed';
}

type StudioSaveResult = { ok: true; added: number; updated: number } | { ok: false; reason: 'limit' | 'project' };

export interface Idea {
  id: string; projectId: string; title: string; description: string;
  votes: number; status: 'open'|'approved'|'rejected'|'implemented'; authorId: string; createdAt: string;
}
export interface KanbanTask {
  id: string; projectId: string; title: string; description: string;
  column: TaskColumn; priority: 'low'|'medium'|'high'|'urgent';
  assigneeId: string; department: string; modelId: string;
  dueAt?: string; createdAt: string; updatedAt: string;
  checklist: { text:string; done:boolean }[];
}

const BOOT_ISO = new Date().toISOString();

function uid(p='id'){ return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`; }

const DEMO_PROJECTS: Project[] = [
  { id:'proj-1', name:'متجر الحرف اليدوية الذكي', description:'منصة بيع منتجات يدوية بمساعد AI للتسعير والتسويق', vision:'تمكين 10 آلاف حرفي من البيع عالمياً', stage:'building', color:'#f59e0b', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, stats:{products:3,ideas:8,tasks:12,revenue:12500} },
  { id:'proj-2', name:'أكاديمية Wora للذكاء', description:'كورسات تفاعلية مع وكلاء يدرّسون', vision:'أكبر أكاديمية عربية للذكاء العملي', stage:'planning', color:'#4f46e5', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, stats:{products:1,ideas:12,tasks:6,revenue:0} },
];
const DEMO_PRODUCTS: Product[] = [
  { id:'prod-1', projectId:'proj-1', name:'سجادة يدوية فارسية', description:'صوف طبيعي نسج يدوي', price:850, cost:400, stock:24, sold:18, image:'🧶', category:'ديكور', status:'active', createdAt:BOOT_ISO },
  { id:'prod-2', projectId:'proj-1', name:'مبخرة نحاسية', description:'نقش يدوي تراثي', price:320, cost:140, stock:40, sold:32, image:'🏺', category:'ديكور', status:'active', createdAt:BOOT_ISO },
  { id:'prod-3', projectId:'proj-1', name:'صندوق هدايا حرفي', description:'تشكيلة منتجات صغيرة', price:150, cost:70, stock:100, sold:45, image:'🎁', category:'هدايا', status:'active', createdAt:BOOT_ISO },
];
const DEMO_IDEAS: Idea[] = [
  { id:'idea-1', projectId:'proj-1', title:'مساعد تسعير ذكي', description:'AI يقترح السعر الأمثل حسب السوق', votes:24, status:'approved', authorId:'agent-product-01', createdAt:BOOT_ISO },
  { id:'idea-2', projectId:'proj-1', title:'تصوير منتجات 360°', description:'ستوديو تلقائي للصور', votes:18, status:'open', authorId:'agent-design-01', createdAt:BOOT_ISO },
  { id:'idea-3', projectId:'proj-2', title:'شهادات NFT للمتعلمين', description:'شهادة موثقة على السلسلة', votes:31, status:'open', authorId:'agent-product-01', createdAt:BOOT_ISO },
];
const DEMO_TASKS: KanbanTask[] = [
  { id:'t-1', projectId:'proj-1', title:'بناء واجهة المتجر', description:'Next.js + Stripe', column:'sprint', priority:'high', assigneeId:'agent-coder-01', department:'engineering', modelId:'claude-sonnet-4-5', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, checklist:[{text:'تصميم Figma',done:true},{text:'كود الواجهة',done:false}] },
  { id:'t-2', projectId:'proj-1', title:'تصوير 20 منتج', description:'إضاءة + خلفية بيضاء', column:'design', priority:'medium', assigneeId:'agent-design-01', department:'design', modelId:'gpt-4o', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, checklist:[] },
  { id:'t-3', projectId:'proj-1', title:'حملة إطلاق إنستغرام', description:'7 بوستات + ريلز', column:'marketing', priority:'high', assigneeId:'agent-marketing-01', department:'marketing', modelId:'gpt-4o', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, checklist:[] },
  { id:'t-4', projectId:'proj-1', title:'فحص أمان الدفع', description:'اختبار اختراق', column:'qa', priority:'urgent', assigneeId:'agent-reviewer-01', department:'qa', modelId:'gpt-4.1', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, checklist:[] },
  { id:'t-5', projectId:'proj-2', title:'صياغة PRD الأكاديمية', description:'أهداف، جمهور، مناهج', column:'ideas', priority:'medium', assigneeId:'agent-product-01', department:'product', modelId:'claude-opus-4-5', createdAt:BOOT_ISO, updatedAt:BOOT_ISO, checklist:[] },
];

export const COLUMN_META: Record<TaskColumn,{ labelAr:string; icon:string; color:string }> = {
  ideas:     { labelAr:'أفكار',     icon:'💡', color:'#f59e0b' },
  backlog:   { labelAr:'بانتظار البدء',    icon:'📋', color:'#64748b' },
  sprint:    { labelAr:'قيد التنفيذ', icon:'🏗️', color:'#0284c7' },
  design:    { labelAr:'تصميم',     icon:'🎨', color:'#ec4899' },
  qa:        { labelAr:'جودة',      icon:'🛡️', color:'#d97706' },
  marketing: { labelAr:'تسويق',     icon:'📣', color:'#0891b2' },
  launched:  { labelAr:'تم الإطلاق', icon:'🚀', color:'#059669' },
  analytics: { labelAr:'تحليلات',   icon:'📊', color:'#7c3aed' },
};

interface ProjectState {
  projects: Project[];
  activeProjectId: string;
  products: Product[];
  ideas: Idea[];
  tasks: KanbanTask[];
  // actions
  setActiveProject: (id:string)=>void;
  createProject: (p: Omit<Project,'id'|'createdAt'|'updatedAt'|'stats'>)=>Project;
  updateProjectStage: (id:string, stage:ProjectStage)=>void;
  addProduct: (p: Omit<Product,'id'|'createdAt'|'sold'>)=>void;
  saveStudioDrafts: (projectId: string, sessionId: string, items: ReadonlyMap<number, StudioDraft>, limit: number) => StudioSaveResult;
  updateProduct: (id:string, patch: Partial<Product>)=>void;
  addIdea: (i: Omit<Idea,'id'|'createdAt'|'votes'|'status'>)=>void;
  voteIdea: (id:string)=>void;
  addTask: (t: Omit<KanbanTask,'id'|'createdAt'|'updatedAt'|'checklist'> & { checklist?: KanbanTask['checklist'] })=>void;
  moveTask: (id:string, column:TaskColumn)=>void;
  deleteTask: (id:string)=>void;
}

export const useProjectStore = create<ProjectState>()(persist((set,get)=>({
  projects: DEMO_PROJECTS,
  activeProjectId: 'proj-1',
  products: DEMO_PRODUCTS,
  ideas: DEMO_IDEAS,
  tasks: DEMO_TASKS,

  setActiveProject: (id)=> set({ activeProjectId:id }),
  createProject: (p)=>{
    const proj: Project = { ...p, id: uid('proj'), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), stats:{products:0,ideas:0,tasks:0,revenue:0} };
    set(s=>({ projects:[...s.projects, proj], activeProjectId: proj.id }));
    return proj;
  },
  updateProjectStage: (id, stage)=> set(s=>({ projects: s.projects.map(pr=> pr.id===id ? {...pr, stage, updatedAt:new Date().toISOString()} : pr ) })),
  addProduct: (p)=> {
    const prod: Product = { ...p, id: uid('prod'), sold:0, createdAt:new Date().toISOString() };
    set(s=>({ products:[...s.products, prod], projects: s.projects.map(pr=> pr.id===p.projectId ? {...pr, stats:{...pr.stats, products: pr.stats.products+1}} : pr ) }));
  },
  saveStudioDrafts: (projectId, sessionId, items, limit) => {
    const { projects, products } = get();
    if (!projects.some((project) => project.id === projectId)) return { ok: false, reason: 'project' };
    const linked = new Map<number, Product>();
    for (const product of products) {
      if (product.projectId === projectId && product.studioRef?.sessionId === sessionId) linked.set(product.studioRef.index, product);
    }
    const additions: Product[] = [];
    const updates = new Map<string, StudioDraft>();
    const now = new Date().toISOString();
    for (const [index, { name, description, category, price, cost }] of items) {
      const draft = { name, description, category, price, cost };
      const existing = linked.get(index);
      if (!existing) {
        additions.push({ ...draft, id: uid('prod'), projectId, studioRef: { sessionId, index }, stock: 0, sold: 0, image: '📦', status: 'draft', createdAt: now });
      } else if (studioSaveState(draft, existing) === 'changed') {
        updates.set(existing.id, draft);
      }
    }
    if (additions.length > Math.max(0, limit - products.length)) return { ok: false, reason: 'limit' };
    if (additions.length || updates.size) {
      const next = [...products.map((product) => updates.has(product.id) ? { ...product, ...updates.get(product.id) } : product), ...additions];
      set({ products: next, projects: projects.map((project) => project.id === projectId ? {
        ...project, updatedAt: now, stats: { ...project.stats, products: next.filter((product) => product.projectId === projectId).length },
      } : project) });
    }
    return { ok: true, added: additions.length, updated: updates.size };
  },
  updateProduct: (id, patch)=> set(s=>({ products: s.products.map(pr=> pr.id===id ? {...pr, ...patch} as Product : pr) })),
  addIdea: (i)=>{
    const idea: Idea = { ...i, id: uid('idea'), votes:0, status:'open', createdAt:new Date().toISOString() };
    set(s=>({ ideas:[...s.ideas, idea], projects: s.projects.map(pr=> pr.id===i.projectId ? {...pr, stats:{...pr.stats, ideas: pr.stats.ideas+1}} : pr) }));
  },
  voteIdea: (id)=> set(s=>({ ideas: s.ideas.map(it=> it.id===id ? {...it, votes: it.votes+1} : it) })),
  addTask: (t)=> {
    const task: KanbanTask = { ...t, id: uid('task'), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), checklist: t.checklist ?? [] };
    set(s=>({ tasks:[...s.tasks, task], projects: s.projects.map(pr=> pr.id===t.projectId ? {...pr, stats:{...pr.stats, tasks: pr.stats.tasks+1}} : pr) }));
  },
  moveTask: (id, column)=> set(s=>({ tasks: s.tasks.map(t=> t.id===id ? {...t, column, updatedAt:new Date().toISOString()} : t) })),
  deleteTask: (id)=> set(s=> {
    const task = s.tasks.find(item => item.id === id);
    if (!task) return s;
    const tasks = s.tasks.filter(item => item.id !== id);
    return { tasks, projects: s.projects.map(project => project.id === task.projectId
      ? { ...project, stats: { ...project.stats, tasks: tasks.filter(item => item.projectId === project.id).length } } : project) };
  }),
}), { name:'wora:projectOS:v6', partialize: s=>({ projects:s.projects, activeProjectId:s.activeProjectId, products:s.products, ideas:s.ideas, tasks:s.tasks }) }));
