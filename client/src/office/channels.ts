/** Stable zone IDs double as links and assignment targets. No physical coordinates or presence simulation. */
export const CHANNELS = [
  { id: 'zone-planning', code: '01', nameAr: 'التخطيط', nameEn: 'PLANNING', subtitleAr: 'الاستراتيجية وخارطة الطريق', tone: 'violet' },
  { id: 'zone-engineering', code: '02', nameAr: 'الهندسة', nameEn: 'ENGINEERING', subtitleAr: 'التطوير والبنية التحتية', tone: 'cyan' },
  { id: 'zone-review', code: '03', nameAr: 'الجودة', nameEn: 'QUALITY', subtitleAr: 'الاختبارات ومراجعة المخرجات', tone: 'gold' },
  { id: 'zone-analytics', code: '04', nameAr: 'البيانات', nameEn: 'ANALYTICS', subtitleAr: 'التحليلات وقياس الأداء', tone: 'mint' },
  { id: 'zone-product', code: '05', nameAr: 'المنتج', nameEn: 'PRODUCT', subtitleAr: 'البحث ومواصفات المنتج', tone: 'gold' },
  { id: 'zone-design', code: '06', nameAr: 'التصميم', nameEn: 'DESIGN', subtitleAr: 'تجربة المستخدم والهوية', tone: 'violet' },
  { id: 'zone-marketing', code: '07', nameAr: 'التسويق', nameEn: 'GROWTH', subtitleAr: 'المحتوى والنمو', tone: 'cyan' },
  { id: 'zone-sales', code: '08', nameAr: 'المبيعات', nameEn: 'SALES', subtitleAr: 'العملاء والدعم', tone: 'pink' },
  { id: 'zone-lounge', code: '09', nameAr: 'التنسيق', nameEn: 'COORDINATION', subtitleAr: 'التواصل بين فرق العمل', tone: 'mint' },
  { id: 'zone-boardroom', code: '10', nameAr: 'المدير', nameEn: 'DIRECTOR', subtitleAr: 'التقارير وإسناد المهام', tone: 'violet' },
] as const;

export type WorkChannel = (typeof CHANNELS)[number];
export const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((channel) => [channel.id, channel])) as Record<string, WorkChannel>;
export const TOUR_STOPS = CHANNELS.map((channel) => channel.id);

export function visibleNodes<T extends { id: string }>(agents: readonly T[], selected: string | null): readonly T[] {
  const first = agents.slice(0, 4);
  if (!selected || first.some(({ id }) => id === selected)) return first;
  const current = agents.find(({ id }) => id === selected);
  return current ? [...first.slice(0, 3), current] : first;
}
