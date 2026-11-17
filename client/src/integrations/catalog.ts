/**
 * catalog.ts — Wora Integrations per Department
 * كل قسم له تكاملاته الحقيقية: GitHub, Vercel, Notion, Gmail, WhatsApp, Meta, Figma...
 */

export type IntegrationId =
  | 'github' | 'vercel' | 'linear' | 'sentry'
  | 'figma' | 'notion' | 'google_drive' | 'slack'
  | 'gmail' | 'meta' | 'tiktok' | 'whatsapp' | 'telegram' | 'google_ads'
  | 'stripe' | 'hubspot' | 'intercom'
  | 'google_analytics' | 'mixpanel' | 'sheets';

export interface IntegrationDef {
  id: IntegrationId;
  nameAr: string; nameEn: string;
  icon: string; color: string; bg: string;
  departments: string[]; // zone ids or department keys
  category: 'code'|'design'|'plan'|'marketing'|'sales'|'data'|'ops';
  descAr: string;
  auth: 'oauth'|'apiKey';
}

export const INTEGRATIONS: IntegrationDef[] = [
  { id:'github', nameAr:'GitHub', nameEn:'GitHub', icon:'⬢', color:'#0B0F19', bg:'#f5f5f4', departments:['zone-engineering','zone-product','zone-review'], category:'code', descAr:'كود، PRs، Actions، Issues', auth:'oauth' },
  { id:'vercel', nameAr:'Vercel', nameEn:'Vercel', icon:'▲', color:'#000000', bg:'#fafafa', departments:['zone-engineering'], category:'code', descAr:'نشر ومعاينات تلقائية', auth:'oauth' },
  { id:'linear', nameAr:'Linear', nameEn:'Linear', icon:'⬣', color:'#5E6AD2', bg:'#eef2ff', departments:['zone-planning','zone-engineering','zone-product'], category:'plan', descAr:'مهام وسبرنتات', auth:'oauth' },
  { id:'sentry', nameAr:'Sentry', nameEn:'Sentry', icon:'◉', color:'#362D59', bg:'#f5f3ff', departments:['zone-review','zone-engineering'], category:'code', descAr:'أخطاء ومراقبة', auth:'oauth' },

  { id:'figma', nameAr:'Figma', nameEn:'Figma', icon:'⬔', color:'#1ABCFE', bg:'#f0fdfa', departments:['zone-design'], category:'design', descAr:'تصاميم ومكونات', auth:'oauth' },
  { id:'notion', nameAr:'Notion', nameEn:'Notion', icon:'N', color:'#000000', bg:'#fafafa', departments:['zone-planning','zone-product','zone-design','zone-boardroom'], category:'plan', descAr:'وثائق وقواعد معرفة', auth:'oauth' },
  { id:'google_drive', nameAr:'Google Drive', nameEn:'Drive', icon:'▭', color:'#1A73E8', bg:'#eff6ff', departments:['zone-design','zone-product','zone-boardroom','zone-analytics'], category:'plan', descAr:'ملفات وموارد', auth:'oauth' },
  { id:'slack', nameAr:'Slack', nameEn:'Slack', icon:'#', color:'#611f69', bg:'#fdf4ff', departments:['zone-boardroom','zone-planning','zone-lounge'], category:'ops', descAr:'تواصل الفريق وتنبيهات', auth:'oauth' },

  { id:'gmail', nameAr:'Gmail', nameEn:'Gmail', icon:'✉', color:'#EA4335', bg:'#fef2f2', departments:['zone-sales','zone-marketing','zone-lounge'], category:'marketing', descAr:'حملات بريدية وردود تلقائية', auth:'oauth' },
  { id:'meta', nameAr:'Meta (فيسبوك وإنستغرام)', nameEn:'Meta', icon:'∞', color:'#0866FF', bg:'#eff6ff', departments:['zone-marketing'], category:'marketing', descAr:'إعلانات ونشر ومحادثات', auth:'oauth' },
  { id:'tiktok', nameAr:'TikTok Ads', nameEn:'TikTok', icon:'♪', color:'#000000', bg:'#fafafa', departments:['zone-marketing'], category:'marketing', descAr:'فيديوهات وإعلانات', auth:'oauth' },
  { id:'whatsapp', nameAr:'WhatsApp Business', nameEn:'WhatsApp', icon:'◈', color:'#25D366', bg:'#f0fdf4', departments:['zone-sales','zone-marketing'], category:'sales', descAr:'رسائل وتأكيد طلبات', auth:'oauth' },
  { id:'telegram', nameAr:'Telegram', nameEn:'Telegram', icon:'✈', color:'#26A5E4', bg:'#eff6ff', departments:['zone-marketing','zone-sales'], category:'marketing', descAr:'قنوات وتنبيهات', auth:'oauth' },
  { id:'google_ads', nameAr:'Google Ads', nameEn:'Google Ads', icon:'G', color:'#4285F4', bg:'#eff6ff', departments:['zone-marketing'], category:'marketing', descAr:'بحث ويوتيوب', auth:'oauth' },

  { id:'stripe', nameAr:'Stripe', nameEn:'Stripe', icon:'$', color:'#635BFF', bg:'#eef2ff', departments:['zone-sales','zone-analytics'], category:'sales', descAr:'مدفوعات واشتراكات', auth:'oauth' },
  { id:'hubspot', nameAr:'HubSpot', nameEn:'HubSpot', icon:'H', color:'#FF7A59', bg:'#fff7ed', departments:['zone-sales'], category:'sales', descAr:'CRM وصفقات', auth:'oauth' },
  { id:'intercom', nameAr:'Intercom', nameEn:'Intercom', icon:'💬', color:'#286EFA', bg:'#eff6ff', departments:['zone-sales'], category:'sales', descAr:'دعم حي ورد آلي', auth:'oauth' },

  { id:'google_analytics', nameAr:'Google Analytics', nameEn:'Analytics', icon:'◐', color:'#E37400', bg:'#fffbeb', departments:['zone-analytics','zone-marketing'], category:'data', descAr:'زيارات وتحويلات', auth:'oauth' },
  { id:'mixpanel', nameAr:'Mixpanel', nameEn:'Mixpanel', icon:'⬥', color:'#7856FF', bg:'#f5f3ff', departments:['zone-analytics'], category:'data', descAr:'أحداث وسلوك', auth:'oauth' },
  { id:'sheets', nameAr:'Google Sheets', nameEn:'Sheets', icon:'▦', color:'#34A853', bg:'#f0fdf4', departments:['zone-analytics','zone-review','zone-sales'], category:'data', descAr:'تقارير وتصدير', auth:'oauth' },
];

export function integrationsForRoom(roomId: string): IntegrationDef[] {
  return INTEGRATIONS.filter(i=> i.departments.includes(roomId));
}
export function integrationsForCategory(cat: IntegrationDef['category']): IntegrationDef[] {
  return INTEGRATIONS.filter(i=> i.category===cat);
}
