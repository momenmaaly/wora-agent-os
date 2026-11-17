import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlanId } from '../billing/plans.js';
import { PLANS } from '../billing/plans.js';

interface BillingState {
  plan: PlanId;
  proSince?: string;
  setPlan: (p: PlanId)=>void;
  isPro: ()=>boolean;
}
export const useBillingStore = create<BillingState>()(persist((set,get)=>({
  plan:'free',
  proSince: undefined,
  setPlan:(plan)=> set({ plan, proSince: plan==='pro' ? new Date().toISOString() : undefined }),
  isPro:()=> get().plan==='pro',
}),{ name:'wora:billing:v1', partialize: s=>({ plan:s.plan, proSince:s.proSince })}));
export function canEntitlement(plan:PlanId, key: keyof typeof PLANS[PlanId]['entitlements']){ return PLANS[plan].entitlements[key]; }
