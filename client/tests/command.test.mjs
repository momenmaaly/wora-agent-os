import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNELS, CHANNEL_BY_ID, TOUR_STOPS, visibleNodes } from '../src/office/channels.ts';

test('all ten channels are available without physical geometry and preserve stable route ids', () => {
  equal(CHANNELS.length, 10);
  equal(new Set(TOUR_STOPS).size, 10);
  ok(TOUR_STOPS.includes('zone-boardroom'));
  for (const channel of CHANNELS) {
    equal(CHANNEL_BY_ID[channel.id], channel);
    ok(!('x' in channel) && !('doors' in channel));
  }
});

test('the mesh fits four real agents and always exposes the selected agent', () => {
  const agents = ['a','b','c','d','e','f'].map((id) => ({ id }));
  deepEqual(visibleNodes([], null), []);
  deepEqual(visibleNodes(agents, null), agents.slice(0, 4));
  deepEqual(visibleNodes(agents, 'not-present'), agents.slice(0, 4));
  deepEqual(visibleNodes(agents, 'e'), [...agents.slice(0, 3), agents[4]]);
  deepEqual(visibleNodes(agents, 'b'), agents.slice(0, 4));
});
