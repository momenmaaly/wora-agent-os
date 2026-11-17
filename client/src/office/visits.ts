import type { OfficeRoom, Point2D } from './layout.js';

export const RECEPTION_POINT: Point2D = { x: 643, y: 915 };

export type WorkArea = 'projects' | 'studio';

export const DEPARTMENT_GUIDE: Record<string, { sign: string; purpose: string; outputs: string; shortcut?: { page: WorkArea; label: string } }> = {
  'zone-product': { sign: 'PRODUCT LAB', purpose: 'هنا يبدأ المنتج. يكتشف الفريق احتياجات العملاء ويحوّلها إلى أفكار ونماذج أولية قابلة للاختبار.', outputs: 'اكتشاف العملاء · نماذج أولية', shortcut: { page: 'studio', label: 'افتح استوديو المنتج' } },
  'zone-planning': { sign: 'STRATEGY', purpose: 'هنا تتحوّل أهداف الشركة إلى خطة واضحة: ما الذي سنبنيه أولاً، ومن المسؤول عن كل خطوة؟', outputs: 'خارطة الطريق · أولويات الأسبوع', shortcut: { page: 'projects', label: 'افتح لوحة المشاريع' } },
  'zone-boardroom': { sign: 'BOARDROOM', purpose: 'تجتمع الفرق هنا لاتخاذ القرارات، ومراجعة تقدّم العمل، وحلّ العوائق قبل التسليم.', outputs: 'اجتماعات الفريق · القرارات', shortcut: { page: 'projects', label: 'راجع المشاريع' } },
  'zone-engineering': { sign: 'ENGINEERING', purpose: 'محطّات التطوير وغرفة الخوادم. هنا يبني المهندسون المنتج ويحوّلون التصاميم إلى تجربة تعمل.', outputs: 'تطوير المنتج · البنية التحتية' },
  'zone-design': { sign: 'DESIGN STUDIO', purpose: 'استوديو الواجهات والهوية. يجمع المصمّمون المراجع، ويرسمون رحلة المستخدم، ويجرّبون النماذج.', outputs: 'تجربة المستخدم · الهوية البصرية' },
  'zone-review': { sign: 'QUALITY LAB', purpose: 'محطّة المراجعة قبل الإطلاق. يختبر الفريق السيناريوهات ويتأكّد أن المخرجات جاهزة للتسليم.', outputs: 'اختبارات الجودة · مراجعة التسليم' },
  'zone-lounge': { sign: 'THE LOUNGE', purpose: 'ركن القهوة والاستقبال. مساحة غير رسمية للقاء الفريق وتبادل الأفكار بين الأقسام.', outputs: 'لقاءات الفريق · الاستقبال' },
  'zone-marketing': { sign: 'GROWTH STUDIO', purpose: 'من طاولة الأفكار إلى خطة الإطلاق. هنا يجهّز الفريق المحتوى والحملات ويتابع أثرها.', outputs: 'خطة الإطلاق · المحتوى', shortcut: { page: 'studio', label: 'حضّر مسودة إطلاق' } },
  'zone-sales': { sign: 'CUSTOMER DESK', purpose: 'هنا يستقبل الفريق أسئلة العملاء ويتابع الفرص ويجمع الملاحظات لتحسين المنتج.', outputs: 'علاقات العملاء · الدعم' },
  'zone-analytics': { sign: 'DATA & FINANCE', purpose: 'شاشات المؤشرات وغرفة العمليات. يراجع الفريق أداء المنتج والتكاليف ليقترح الخطوة التالية.', outputs: 'مؤشرات الأداء · المالية' },
};

export const TOUR_STOPS = [
  'zone-planning', 'zone-product', 'zone-design', 'zone-engineering', 'zone-review',
  'zone-boardroom', 'zone-marketing', 'zone-sales', 'zone-analytics', 'zone-lounge',
] as const;

export function roomEntrance(room: OfficeRoom, hallY: number) {
  const facing = room.y < hallY ? 'south' : 'north';
  const door = room.doors.find((item) => item.wall === facing);
  const x = door ? (door.from + door.to) / 2 : room.x + room.width / 2;
  return { x, y: facing === 'south' ? room.y + room.height - 49 : room.y + 49 };
}

/** The visitor uses each room's main door and the shared central hallway. */
export function visitorRoute(from: Point2D, roomId: string | null, rooms: readonly OfficeRoom[], hallY: number): Point2D[] {
  const destination = rooms.find((room) => room.id === (roomId ?? 'zone-lounge'));
  if (!destination) return [];
  const current = rooms.find((room) => from.x > room.x && from.x < room.x + room.width && from.y > room.y && from.y < room.y + room.height);
  const door = roomEntrance(destination, hallY);
  const target = roomId ? door : RECEPTION_POINT;
  const exit = current ? roomEntrance(current, hallY) : from;
  const path = current?.id === destination.id ? [target] : [
    ...(current ? [exit] : []), { x: exit.x, y: hallY }, { x: door.x, y: hallY }, door, ...(roomId ? [] : [target]),
  ];
  return path.filter((point, index) => {
    const prev = index ? path[index - 1]! : from;
    return Math.hypot(point.x - prev.x, point.y - prev.y) > 1;
  });
}
