/**
 * plans.ts — Wora Plans & Entitlements
 * Free = open models + core campus. Pro = unlocked campus + real power.
 */

export type PlanId = 'free' | 'pro';

export interface PlanDef {
  id: PlanId;
  nameAr: string; nameEn: string;
  priceSAR: number; priceUSD: number; interval: string;
  badge: string; accent: string; bg: string;
  features: string[];
  limits: { projects: number; products: number; tasksPerProject: number; ideas: number; agents: number; historyDays: number; integrations: number };
  entitlements: {
    flagshipModels: boolean; byok: boolean; productStudio: boolean;
    advancedKanban: boolean; marketingAuto: boolean; analyticsPro: boolean;
    customBranding: boolean; prioritySupport: boolean; apiAccess: boolean;
    privateRooms: boolean; realDeploy: boolean;
  };
  proRooms: string[]; // rooms that are premium-locked
}

export const FREE_MODEL_IDS = new Set<string>([
  'llama-3.3-70b-versatile','llama-3.1-405b','mixtral-8x7b-32768','qwen-qwq-32b',
  'mistral-small-2409','codestral-2405',
  'qwen2.5-72b-instruct','qwen2.5-coder-32b',
  'deepseek-chat','deepseek-coder',
  'command-r-08-2024',
  'gemini-2.5-flash-lite',
]);

// Pro unlocks 3 premium pavilions
export const PRO_ROOM_IDS = ['zone-boardroom','zone-design','zone-analytics'] as const;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id:'free', nameAr:'المجانية', nameEn:'Free', priceSAR:0, priceUSD:0, interval:'للأبد',
    badge:'ابدأ مجاناً', accent:'#78716c', bg:'#f5f5f4',
    features:[
      '8 نماذج مفتوحة فائقة السرعة (Groq/Qwen/DeepSeek) — بلا بطاقة',
      '7 أجنحة أساسية + كل الوكلاء + كانبان ومتجر جاهز',
      'مشروعين · 10 منتجات · 20 مهمة/مشروع',
      'الواحة والحديقة المائية تعمل كاملة',
    ],
    limits:{ projects:2, products:10, tasksPerProject:20, ideas:15, agents:6, historyDays:7, integrations:3 },
    entitlements:{ flagshipModels:false, byok:false, productStudio:false, advancedKanban:false, marketingAuto:false, analyticsPro:false, customBranding:false, prioritySupport:false, apiAccess:false, privateRooms:false, realDeploy:false },
    proRooms: [],
  },
  pro: {
    id:'pro', nameAr:'المحترفة', nameEn:'Pro', priceSAR:149, priceUSD:39, interval:'شهرياً',
    badge:'الأكثر طلباً', accent:'#CBA36B', bg:'#0B0F19',
    features:[
      '32 نموذجاً — GPT-4.1 · Claude Opus 4.5 · Gemini 2.5 Pro · Grok · Sonar + BYOK بلا حدود',
      'يفتح 3 أجنحة مقفلة: القيادة التنفيذية + استوديو التصميم + مركز البيانات — مع شرفات وغرف اجتماعات زجاجية',
      'مولد المنتجات: كلمة → براند + 3 منتجات مسعرة + حملة إطلاق',
      'نشر حقيقي: GitHub → Vercel بضغطة، Stripe/Meta/WhatsApp مباشرة، تكاملات بلا حدود',
      'بلا علامة Wora · تحليلات Pro · API · دعم أولوية · 365 يوم سجل',
    ],
    limits:{ projects:999, products:9999, tasksPerProject:9999, ideas:9999, agents:99, historyDays:365, integrations:999 },
    entitlements:{ flagshipModels:true, byok:true, productStudio:true, advancedKanban:true, marketingAuto:true, analyticsPro:true, customBranding:true, prioritySupport:true, apiAccess:true, privateRooms:true, realDeploy:true },
    proRooms: [...PRO_ROOM_IDS],
  },
};

export function isModelAllowedForPlan(modelId: string, plan: PlanId): boolean {
  if (plan === 'pro') return true;
  return FREE_MODEL_IDS.has(modelId);
}
export function isRoomLockedForPlan(roomId: string, plan: PlanId): boolean {
  if (plan === 'pro') return false;
  return (PRO_ROOM_IDS as readonly string[]).includes(roomId);
}
