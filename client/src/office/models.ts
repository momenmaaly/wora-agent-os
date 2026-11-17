/**
 * models.ts — Wora Full Model Catalog + Department Registry
 * ─────────────────────────────────────────────────────────
 * نماذج مصنّفة حسب القسم للمقارنة في مكتبة النماذج.
 */
import { BrainProvider } from '../types.js';

export type ModelTier = 'flagship' | 'balanced' | 'fast' | 'specialized';
export type ModelCost = '$' | '$$' | '$$$' | '$$$$';
export type DepartmentId =
  | 'product'
  | 'planning'
  | 'engineering'
  | 'design'
  | 'qa'
  | 'marketing'
  | 'sales'
  | 'analytics'
  | 'finance'
  | 'lounge';

export interface ModelDef {
  id:            string;
  provider:      BrainProvider | string;
  displayName:   string;
  family:        string;
  tier:          ModelTier;
  cost:          ModelCost;
  contextWindow: string;
  strengths:     string[];
  departments:   DepartmentId[];
  speedMs:       number; // avg p50 ms
  recommended?:  boolean;
}

export const MODEL_CATALOG: readonly ModelDef[] = [
  // ── Google Gemini ──
  { id: 'gemini-2.5-pro',            provider: BrainProvider.Google, displayName: 'Gemini 2.5 Pro',          family: 'Gemini', tier: 'flagship', cost: '$$$', contextWindow: '2M', strengths: ['تفكير عميق','تحليل منتج','كود معقد'], departments: ['product','planning','engineering','analytics'], speedMs: 1800, recommended: true },
  { id: 'gemini-2.5-flash',           provider: BrainProvider.Google, displayName: 'Gemini 2.5 Flash',        family: 'Gemini', tier: 'balanced', cost: '$$',  contextWindow: '1M', strengths: ['سريع ومتوازن','مهام يومية','دردشة'],       departments: ['product','planning','engineering','marketing','sales','analytics'], speedMs: 600, recommended: true },
  { id: 'gemini-2.5-flash-lite',       provider: BrainProvider.Google, displayName: 'Gemini 2.5 Flash Lite',   family: 'Gemini', tier: 'fast',     cost: '$',   contextWindow: '32K', strengths: ['فائق السرعة','تصنيف','تلخيص'],        departments: ['marketing','sales','analytics','lounge'], speedMs: 280 },
  { id: 'gemini-2.0-flash-exp',        provider: BrainProvider.Google, displayName: 'Gemini 2.0 Flash Exp',    family: 'Gemini', tier: 'balanced', cost: '$$',  contextWindow: '1M', strengths: ['متعدد الوسائط','رؤية','صوت'],         departments: ['design','marketing','product'], speedMs: 700 },

  // ── OpenAI ──
  { id: 'gpt-4.1',                    provider: BrainProvider.OpenAI, displayName: 'GPT-4.1',                 family: 'OpenAI', tier: 'flagship', cost: '$$$$', contextWindow: '1M', strengths: ['أقوى تحليل','كتابة استراتيجية','أكواد ضخمة'], departments: ['product','planning','qa','finance'], speedMs: 1400, recommended: true },
  { id: 'gpt-4.1-mini',               provider: BrainProvider.OpenAI, displayName: 'GPT-4.1 Mini',            family: 'OpenAI', tier: 'balanced', cost: '$$',  contextWindow: '128K', strengths: ['متوازن','اقتصادي','سريع'],     departments: ['engineering','marketing','sales'], speedMs: 650 },
  { id: 'gpt-4o',                     provider: BrainProvider.OpenAI, displayName: 'GPT-4o',                  family: 'OpenAI', tier: 'flagship', cost: '$$$', contextWindow: '128K', strengths: ['إبداع','محتوى','رؤية'],          departments: ['marketing','design','product','sales'], speedMs: 900, recommended: true },
  { id: 'gpt-4o-mini',                provider: BrainProvider.OpenAI, displayName: 'GPT-4o Mini',             family: 'OpenAI', tier: 'fast',     cost: '$',   contextWindow: '128K', strengths: ['رخيص وسريع','دعم عملاء'],    departments: ['sales','lounge','marketing'], speedMs: 350 },
  { id: 'o4-mini',                    provider: BrainProvider.OpenAI, displayName: 'o4 mini (reasoning)',     family: 'OpenAI', tier: 'specialized', cost: '$$$', contextWindow: '200K', strengths: ['تفكير منطقي','رياضيات','ألغاز'], departments: ['engineering','qa','analytics'], speedMs: 2200 },
  { id: 'o3-mini',                    provider: BrainProvider.OpenAI, displayName: 'o3 mini',                 family: 'OpenAI', tier: 'specialized', cost: '$$',  contextWindow: '200K', strengths: ['STEM','تحليل عميق'],        departments: ['analytics','product'], speedMs: 1800 },

  // ── Anthropic ──
  { id: 'claude-opus-4-5',            provider: BrainProvider.Anthropic, displayName: 'Claude Opus 4.5',     family: 'Claude', tier: 'flagship', cost: '$$$$', contextWindow: '200K', strengths: ['أذكى نموذج','PRD','بحث معمق'], departments: ['product','planning','engineering'], speedMs: 2100, recommended: true },
  { id: 'claude-sonnet-4-5',           provider: BrainProvider.Anthropic, displayName: 'Claude Sonnet 4.5',    family: 'Claude', tier: 'balanced', cost: '$$$', contextWindow: '200K', strengths: ['كود ممتاز','متوازن','موثوق'],   departments: ['engineering','design','qa','product'], speedMs: 1100, recommended: true },
  { id: 'claude-haiku-4-5',            provider: BrainProvider.Anthropic, displayName: 'Claude Haiku 4.5',     family: 'Claude', tier: 'fast',     cost: '$',   contextWindow: '200K', strengths: ['فائق السرعة','دعم','تلخيص'], departments: ['sales','marketing','lounge','qa'], speedMs: 400 },
  { id: 'claude-sonnet-4-0',           provider: BrainProvider.Anthropic, displayName: 'Claude Sonnet 4.0',    family: 'Claude', tier: 'balanced', cost: '$$$', contextWindow: '200K', strengths: ['مستقر','إنتاجي'],            departments: ['engineering','qa'], speedMs: 1000 },

  // ── Groq / Llama / Open ──
  { id: 'llama-3.3-70b-versatile',     provider: BrainProvider.Groq, displayName: 'Llama 3.3 70B',            family: 'Llama', tier: 'balanced', cost: '$',   contextWindow: '128K', strengths: ['مفتوح','سريع جداً (Groq)','تحليل'], departments: ['analytics','engineering','marketing'], speedMs: 180, recommended: true },
  { id: 'llama-3.1-405b',              provider: BrainProvider.Groq, displayName: 'Llama 3.1 405B',            family: 'Llama', tier: 'flagship', cost: '$$',  contextWindow: '128K', strengths: ['ضخم','مفتوح','بحث'],       departments: ['analytics','product'], speedMs: 450 },
  { id: 'mixtral-8x7b-32768',          provider: BrainProvider.Groq, displayName: 'Mixtral 8x7B',              family: 'Mistral', tier: 'balanced', cost: '$',   contextWindow: '32K', strengths: ['متعدد الخبراء','اقتصادي'],   departments: ['sales','lounge','marketing'], speedMs: 220 },
  { id: 'qwen-qwq-32b',                provider: BrainProvider.Groq, displayName: 'Qwen QwQ 32B (reasoning)', family: 'Qwen',  tier: 'specialized', cost: '$',   contextWindow: '32K', strengths: ['تفكير','رياضيات'],           departments: ['analytics','qa'], speedMs: 500 },

  // ── Mistral ──
  { id: 'mistral-large-2407',          provider: 'mistral' as unknown as BrainProvider, displayName: 'Mistral Large 2',   family: 'Mistral', tier: 'flagship', cost: '$$$', contextWindow: '128K', strengths: ['أوروبي','متعدد اللغات','وظائف'], departments: ['engineering','marketing','product'], speedMs: 800 },
  { id: 'codestral-2405',              provider: 'mistral' as unknown as BrainProvider, displayName: 'Codestral',          family: 'Mistral', tier: 'specialized', cost: '$$',  contextWindow: '32K', strengths: ['كود متخصص','إكمال'],        departments: ['engineering'], speedMs: 600 },
  { id: 'mistral-small-2409',          provider: 'mistral' as unknown as BrainProvider, displayName: 'Mistral Small',     family: 'Mistral', tier: 'fast',     cost: '$',   contextWindow: '32K', strengths: ['سريع','رخيص'],             departments: ['sales','lounge'], speedMs: 300 },

  // ── Cohere ──
  { id: 'command-r-plus-08-2024',      provider: 'cohere' as unknown as BrainProvider, displayName: 'Command R+',         family: 'Cohere', tier: 'balanced', cost: '$$',  contextWindow: '128K', strengths: ['RAG','بحث','أدوات'],        departments: ['marketing','sales','analytics'], speedMs: 700 },
  { id: 'command-r-08-2024',           provider: 'cohere' as unknown as BrainProvider, displayName: 'Command R',          family: 'Cohere', tier: 'fast',     cost: '$',   contextWindow: '128K', strengths: ['سريع','تلخيص'],            departments: ['sales','lounge'], speedMs: 350 },

  // ── DeepSeek ──
  { id: 'deepseek-chat',               provider: 'deepseek' as unknown as BrainProvider, displayName: 'DeepSeek V3 Chat', family: 'DeepSeek', tier: 'flagship', cost: '$$',  contextWindow: '128K', strengths: ['قوي جداً','رخيص','كود'],    departments: ['engineering','analytics','product'], speedMs: 900 },
  { id: 'deepseek-coder',              provider: 'deepseek' as unknown as BrainProvider, displayName: 'DeepSeek Coder V2',family: 'DeepSeek', tier: 'specialized', cost: '$',   contextWindow: '128K', strengths: ['كود متخصص','إصلاح'],      departments: ['engineering','qa'], speedMs: 750 },

  // ── Qwen / Alibaba ──
  { id: 'qwen2.5-72b-instruct',         provider: 'qwen' as unknown as BrainProvider, displayName: 'Qwen 2.5 72B',       family: 'Qwen', tier: 'flagship', cost: '$$',  contextWindow: '128K', strengths: ['متعدد اللغات','عربي ممتاز'], departments: ['marketing','product','sales'], speedMs: 800 },
  { id: 'qwen2.5-coder-32b',            provider: 'qwen' as unknown as BrainProvider, displayName: 'Qwen 2.5 Coder 32B',  family: 'Qwen', tier: 'specialized', cost: '$',   contextWindow: '128K', strengths: ['كود عربي/إنجليزي'],       departments: ['engineering'], speedMs: 600 },

  // ── xAI / Perplexity / Others ──
  { id: 'grok-2-1212',                  provider: 'xai' as unknown as BrainProvider, displayName: 'Grok 2',             family: 'xAI', tier: 'balanced', cost: '$$$', contextWindow: '131K', strengths: ['ساخر','مباشر','X'],         departments: ['marketing','lounge'], speedMs: 850 },
  { id: 'sonar-pro',                   provider: 'perplexity' as unknown as BrainProvider, displayName: 'Perplexity Sonar Pro', family: 'Perplexity', tier: 'specialized', cost: '$$',  contextWindow: '200K', strengths: ['بحث حي','ويب','مصادر'], departments: ['analytics','product','marketing'], speedMs: 1100 },
];

export const DEPARTMENTS: readonly {
  id:          DepartmentId;
  nameAr:      string;
  nameEn:      string;
  icon:        string;
  color:       string;
  description: string;
  roles:       string[];
}[] = [
  { id: 'product',     nameAr: 'إدارة المنتج والابتكار',    nameEn: 'Product & Innovation', icon: '💡', color: '#f59e0b', description: 'اكتشاف الأفكار وتحويلها لمنتجات', roles: ['مدير منتج','باحث سوق','مبتكر'] },
  { id: 'planning',    nameAr: 'التخطيط والاستراتيجية',     nameEn: 'Planning & Strategy',  icon: '🗺️', color: '#4f46e5', description: 'خارطة الطريق والسبرنتات',      roles: ['مخطط استراتيجي','Scrum Master'] },
  { id: 'engineering', nameAr: 'الهندسة والتطوير',          nameEn: 'Engineering',          icon: '⚙️', color: '#0284c7', description: 'بناء الكود والبنية التحتية',   roles: ['مهندس أول','مهندس خلفية','مهندس واجهة'] },
  { id: 'design',      nameAr: 'التصميم وتجربة المستخدم',   nameEn: 'Design & UX',          icon: '🎨', color: '#ec4899', description: 'واجهات وهوية بصرية',          roles: ['مصمم UX','مصمم UI','باحث UX'] },
  { id: 'qa',          nameAr: 'الجودة والأمان',            nameEn: 'QA & Security',        icon: '🛡️', color: '#d97706', description: 'اختبار وأمن سيبراني',         roles: ['مهندس QA','مدقق أمني'] },
  { id: 'marketing',   nameAr: 'التسويق والنمو',            nameEn: 'Marketing & Growth',   icon: '📣', color: '#0d9488', description: 'محتوى، SEO، سوشيال، إعلانات', roles: ['كاتب محتوى','خبير SEO','مدير سوشيال','مختص إعلانات'] },
  { id: 'sales',       nameAr: 'المبيعات والدعم',           nameEn: 'Sales & Support',      icon: '🤝', color: '#7c3aed', description: 'إغلاق صفقات ودعم عملاء',      roles: ['مندوب مبيعات','أخصائي دعم'] },
  { id: 'analytics',   nameAr: 'البيانات والتحليلات',       nameEn: 'Analytics & Data',     icon: '📊', color: '#059669', description: 'قياس وتحسين مستمر',          roles: ['محلل بيانات','عالم بيانات'] },
  { id: 'finance',     nameAr: 'المالية والعمليات',          nameEn: 'Finance & Ops',        icon: '💰', color: '#475569', description: 'ميزانية وتشغيل',            roles: ['محاسب','مدير عمليات'] },
  { id: 'lounge',      nameAr: 'الثقافة والاستراحة',        nameEn: 'Culture & Lounge',     icon: '☕', color: '#78716c', description: 'قهوة وثقافة وفعاليات',        roles: ['منسق ثقافة','مضيف'] },
];

export function modelsForDepartment(dep: DepartmentId): ModelDef[] {
  return MODEL_CATALOG.filter(m => m.departments.includes(dep));
}
export function modelsForProvider(provider: string): ModelDef[] {
  return MODEL_CATALOG.filter(m => m.provider === provider);
}
export function getModelById(id: string): ModelDef | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}
