/**
 * plans.ts — Wora Plans & Entitlements
 * Free = open models only + caps. Pro = everything.
 */

export type PlanId = 'free' | 'pro';

export interface PlanDef {
  id: PlanId;
  nameAr: string; nameEn: string;
  priceSAR: number; priceUSD: number; interval: string;
  badge: string; accent: string; bg: string;
  features: string[];
  limits: {
    projects: number; products: number; tasksPerProject: number;
    ideas: number; agents: number; historyDays: number;
  };
  entitlements: {
    flagshipModels: boolean; byok: boolean; productStudio: boolean;
    advancedKanban: boolean; marketingAuto: boolean; analyticsPro: boolean;
    customBranding: boolean; prioritySupport: boolean; apiAccess: boolean;
  };
}

// Free: only open-weight / free-tier models
export const FREE_MODEL_IDS = new Set<string>([
  // Groq ultra-fast open
  'llama-3.3-70b-versatile','llama-3.1-405b','mixtral-8x7b-32768','qwen-qwq-32b',
  // Mistral small / Codestral free
  'mistral-small-2409','codestral-2405',
  // Qwen open
  'qwen2.5-72b-instruct','qwen2.5-coder-32b',
  // DeepSeek free tier
  'deepseek-chat','deepseek-coder',
  // Cohere free
  'command-r-08-2024',
  // Gemini flash-lite free
  'gemini-2.5-flash-lite',
]);

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id:'free', nameAr:'المجانية', nameEn:'Free', priceSAR:0, priceUSD:0, interval:'للأبد',
    badge:'مجاناً', accent:'#78716c', bg:'#f5f5f4',
    features:[
      '8 نماذج مفتوحة فائقة السرعة (Groq/Qwen/DeepSeek)',
      'مشروعين + 10 منتجات + كانبان أساسي',
      'متجر جاهز وروابط دفع',
      'مقر 10 غرف مع كل الوكلاء',
    ],
    limits:{ projects:2, products:10, tasksPerProject:20, ideas:15, agents:6, historyDays:7 },
    entitlements:{ flagshipModels:false, byok:false, productStudio:false, advancedKanban:false, marketingAuto:false, analyticsPro:false, customBranding:false, prioritySupport:false, apiAccess:false },
  },
  pro: {
    id:'pro', nameAr:'المحترفة', nameEn:'Pro', priceSAR:149, priceUSD:39, interval:'شهرياً',
    badge:'الأكثر طلباً', accent:'#0f172a', bg:'#0f172a',
    features:[
      '32 نموذجاً — كل العمالقة: GPT-4.1, Claude Opus 4.5, Gemini 2.5 Pro, Grok, Sonar',
      'BYOK — استخدم مفاتيحك الخاصة بلا حدود',
      'مولد المنتجات الاحترافي: كلمة → براند + متجر + حملة',
      'مشاريع ومنتجات غير محدودة + كانبان 8 أعمدة + أتمتة تسويق',
      'تحليلات Pro وتصدير API ودعم أولوية',
      'هوية خاصة للمتجر وإزالة علامة Wora',
    ],
    limits:{ projects:999, products:9999, tasksPerProject:9999, ideas:9999, agents:99, historyDays:365 },
    entitlements:{ flagshipModels:true, byok:true, productStudio:true, advancedKanban:true, marketingAuto:true, analyticsPro:true, customBranding:true, prioritySupport:true, apiAccess:true },
  },
};

export function isModelAllowedForPlan(modelId: string, plan: PlanId): boolean {
  if (plan === 'pro') return true;
  return FREE_MODEL_IDS.has(modelId);
}
export function getPlanPrice(plan: PlanId, currency:'SAR'|'USD'='SAR'){ const p=PLANS[plan]; return currency==='SAR' ? `${p.priceSAR} ر.س` : `$${p.priceUSD}`; }
