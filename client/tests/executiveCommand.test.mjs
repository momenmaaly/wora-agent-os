import { equal } from 'node:assert/strict';
import { test } from 'node:test';
import { queueExecutiveCommand, takeExecutiveCommand } from '../src/executiveCommand.ts';

class MemorySessionStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

test('Executive Command is queued for the real Director composer and consumed once', () => {
  const previousWindow = globalThis.window;
  const dispatched = [];
  globalThis.window = {
    sessionStorage: new MemorySessionStorage(),
    dispatchEvent: (event) => { dispatched.push(event); return true; },
  };
  try {
    equal(queueExecutiveCommand(''), '');
    const brief = queueExecutiveCommand('  Prepare and schedule this week’s videos  ');
    equal(brief, 'Prepare and schedule this week’s videos');
    equal(dispatched.length, 1);
    equal(dispatched[0].detail, brief);
    equal(takeExecutiveCommand(), brief);
    equal(takeExecutiveCommand(), '', 'the command is not replayed as fabricated activity');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
