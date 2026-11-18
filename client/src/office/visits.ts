import type { OfficeRoom, Point2D } from './layout.js';

export const RECEPTION_POINT: Point2D = { x: 643, y: 915 };

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
