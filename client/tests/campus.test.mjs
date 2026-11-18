import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { RECEPTION_POINT, TOUR_STOPS, visitorRoute } from '../src/office/visits.ts';
import { outline, project, roomCamera, SCENE_FRAME } from '../src/office/spatial.ts';

const hall = 440;
const reception = { id: 'zone-lounge', x: 518, y: 520, width: 310, height: 512, doors: [{ wall: 'north', from: 610, to: 682 }] };
const engineering = { id: 'zone-engineering', x: 1318, y: 48, width: 310, height: 312, doors: [{ wall: 'south', from: 1408, to: 1480 }] };
const rooms = [reception, engineering];

test('the tour has ten distinct departments including the manager’s room', () => {
  equal(TOUR_STOPS.length, 10);
  equal(new Set(TOUR_STOPS).size, 10);
  ok(TOUR_STOPS.includes('zone-boardroom'));
});

test('the visitor reaches departments by their hallway-facing doors', () => {
  const path = visitorRoute(RECEPTION_POINT, engineering.id, rooms, hall);
  deepEqual(path, [{ x: 646, y: 569 }, { x: 646, y: hall }, { x: 1444, y: hall }, { x: 1444, y: 311 }]);
  deepEqual(visitorRoute(path.at(-1), null, rooms, hall), [{ x: 1444, y: hall }, { x: 646, y: hall }, { x: 646, y: 569 }, RECEPTION_POINT]);
  deepEqual(visitorRoute(RECEPTION_POINT, null, rooms, hall), []);
  deepEqual(visitorRoute(RECEPTION_POINT, 'missing-room', rooms, hall), []);
});

test('the model and its room camera keep the building inside the artboard', () => {
  for (const point of outline(0, 0, 2000, 1080)) {
    ok(point.x > 0 && point.x < SCENE_FRAME.width);
    ok(point.y > 0 && point.y < SCENE_FRAME.height);
  }
  ok(project(100, 600, 30).y < project(100, 600).y, 'higher objects appear higher in the scene');
  const camera = roomCamera(engineering);
  ok(camera.scale > 2 && camera.scale < 4);
  deepEqual(camera.center, project(engineering.x + engineering.width / 2, engineering.y + engineering.height / 2, 34));
});
