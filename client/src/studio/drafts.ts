export type StudioPositioning = 'accessible' | 'balanced' | 'premium';
export type StudioBrief = { idea: string; audience: string; positioning: StudioPositioning };
export type StudioDraft = { name: string; description: string; category: string; price: number; cost: number };
export type StudioPack = { title: string; summary: string; drafts: StudioDraft[]; launch: { tagline: string; actions: string[] } };
export type StudioSource = 'live' | 'template';

export const MIN_IDEA = 8;
export const MAX_IDEA = 500;
export const MAX_AUDIENCE = 120;
export const MAX_DRAFT_MONEY = 1_000_000;
export const SOURCE_LABEL: Record<StudioSource, string> = { live: 'توليد مباشر', template: 'قالب محلي' };

export const POSITIONING: Record<StudioPositioning, string> = { accessible: 'اقتصادي', balanced: 'متوازن', premium: 'فاخر' };
export const STUDIO_EXAMPLES: { label: string; brief: StudioBrief }[] = [
  { label: 'قهوة مختصّة', brief: { idea: 'مجموعة قهوة مختصّة بتغليف مستدام', audience: 'عشّاق تحضير القهوة في المنزل', positioning: 'balanced' } },
  { label: 'حرف يدوية', brief: { idea: 'مجموعة حرف يدوية مستوحاة من التراث', audience: 'الباحثون عن هدايا محلية غير تقليدية', positioning: 'balanced' } },
  { label: 'عطور عربية', brief: { idea: 'عطور عربية فاخرة للهدايا', audience: 'محبّو العطور العربية الفاخرة', positioning: 'premium' } },
];

const TEMPLATES = [
  { key: /قهو|محامص/u, category: 'قهوة مختصّة', name: 'إصدار المحمصة', detail: 'مجموعة تذوّق بدرجات تحميص مختلفة، مع بطاقة توضّح طرق التحضير.', test: 'نظّم جلسة تذوّق صغيرة وسجّل تفضيلات المشاركين.' },
  { key: /حرف|سجاد|ديكور|نسيج/u, category: 'حرف يدوية', name: 'إصدار الحرفيين', detail: 'قطعة مصنوعة يدوياً مع بطاقة تروي قصة الخامة والحرفة.', test: 'اعرض نموذجاً أوّل لكل قطعة واختبر الخامة والتغليف مع المشترين.' },
  { key: /عطر|عطور|بخور/u, category: 'عطور', name: 'إصدار العطور', detail: 'تشكيلة عينات عطرية مع دليل مختصر للنوتات وطريقة الاستخدام.', test: 'جرّب عينات صغيرة مع العملاء قبل اختيار الرائحة الأساسية.' },
  { key: /ملابس|أزياء/u, category: 'أزياء', name: 'الإصدار اليومي', detail: 'قطعة عملية للاستخدام اليومي، تُعرض مع دليل المقاسات والخامات.', test: 'اختبر المقاسات وتجربة الاستخدام قبل تثبيت تشكيلة الألوان.' },
];
const GENERIC = { category: 'تشكيلة أولية', name: 'الإصدار الأول', detail: 'نموذج أولي يركّز على الميّزة الأساسية لاختبار الطلب قبل التوسّع.', test: 'شارك النموذج الأولي واجمع ملاحظات مجموعة صغيرة من العملاء.' };
const FACTOR: Record<StudioPositioning, number> = { accessible: .78, balanced: 1, premium: 1.45 };
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export const formatUSD = (value: number) => formatter.format(value);
export const margin = (draft: StudioDraft) => draft.price > 0 ? Math.round((draft.price - draft.cost) / draft.price * 100) : null;

function shorten(value: string, max: number) {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function makeTemplatePack(brief: StudioBrief): StudioPack {
  const template = TEMPLATES.find((item) => item.key.test(brief.idea)) ?? GENERIC;
  const title = shorten(brief.idea, 75);
  const audience = brief.audience.trim();
  const factor = FACTOR[brief.positioning];
  const firstName = `${template.name} — ${shorten(brief.idea, 51)}`;
  return {
    title,
    summary: `تشكيلة مبدئية بثلاث صيغ لاختبار «${title}». ${audience ? `صُمّمت لـ ${shorten(audience, 100)}. ` : ''}التسعير المقترح: ${POSITIONING[brief.positioning]}.`,
    drafts: [
      { name: firstName, description: template.detail, price: 29, cost: 12 },
      { name: `${template.category} — باقة التجربة`, description: 'باقة صغيرة بتكلفة دخول أقل، مناسبة لجمع ملاحظات أول العملاء.', price: 14, cost: 6 },
      { name: `${template.category} — باقة الإهداء`, description: 'تشكيلة مختارة مع تغليف قابل للتخصيص ومكان لرسالة الإهداء.', price: 48, cost: 20 },
    ].map((item) => ({ ...item, category: template.category, price: Math.round(item.price * factor), cost: Math.round(item.cost * factor) })),
    launch: {
      tagline: `${template.name} · اكتشف التشكيلة الأولى`,
      actions: [template.test, 'احسب تكلفة التجهيز والتغليف والشحن، وحدّث الأسعار قبل البيع.', 'حضّر عرضاً للتشكيلة قبل الإطلاق، وأطلق نسخة محدودة بعد مراجعة الملاحظات.'],
    },
  };
}

export function packAsText(brief: StudioBrief, pack: StudioPack, source: StudioSource): string {
  return [
    `WORA STUDIO\n${pack.title}\n${source === 'live' ? 'مسودات بالتوليد المباشر' : 'مسودات من قالب معاينة'}`,
    `الموجز\n${brief.idea}\n${brief.audience ? `الجمهور: ${brief.audience}\n` : ''}مستوى التسعير: ${POSITIONING[brief.positioning]}`,
    `التصوّر\n${pack.summary}`,
    `المسودات (USD، تقديرات)\n${pack.drafts.map((item, index) => `${index + 1}. ${item.name}\nالفئة: ${item.category}\n${item.description}\nالسعر ${formatUSD(item.price)} | التكلفة ${formatUSD(item.cost)} | الهامش ${margin(item) === null ? '—' : `${margin(item)}%`}`).join('\n\n')}`,
    'الأسعار والتكاليف تقديرية. الهامش لا يشمل الشحن أو الرسوم.',
    `خطة مراجعة قبل الإطلاق\n${pack.launch.tagline}\n${pack.launch.actions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`,
  ].join('\n\n');
}
