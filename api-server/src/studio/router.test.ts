import { deepEqual, equal, ok } from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import express from 'express';
import { createStudioRouter, type StudioService } from './router.js';

const brief = { idea: 'منتجات قهوة لعشاق التحضير المنزلي', audience: 'محبّو القهوة', positioning: 'premium' };
const validPack = {
  title: 'مختبر القهوة', summary: 'مجموعة لاختبار نكهات مختلفة.',
  drafts: ['أ', 'ب', 'ج'].map((label) => ({ name: `مسودة ${label}`, description: 'تجربة عملية.', category: 'قهوة', price: 18.5, cost: 8 })),
  launch: { tagline: 'اكتشف التشكيلة الأولى', actions: ['اختبر التشكيلة', 'حدد الأسعار', 'راجع الإطلاق'] },
};

async function makeApp(t: TestContext, service?: StudioService, timeout?: number) {
  const app = express();
  app.use('/api/studio', createStudioRouter(service, timeout));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}/api/studio`;
}

function post(base: string, body: object = brief, signedIn = true) {
  return fetch(`${base}/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signedIn ? { Authorization: 'Bearer test-session' } : {}) }, body: JSON.stringify(body) });
}
function service(overrides?: Partial<StudioService>): StudioService {
  return {
    authenticate: (header) => header === 'Bearer test-session' ? 'test-user' : null,
    consumeQuota: async () => null,
    generate: async () => JSON.stringify(validPack),
    ...overrides,
  };
}

test('an unconfigured Studio offers local templates and does not accept direct generation', async (t) => {
  const base = await makeApp(t);
  const status = await fetch(`${base}/status`);
  equal(status.headers.get('Cache-Control'), 'no-store');
  deepEqual(await status.json(), { mode: 'template', reason: 'unconfigured' });
  equal((await post(base)).status, 503);
});

test('only an authenticated, valid brief consumes quota or calls a configured provider', async (t) => {
  const permitted: string[] = [];
  let invocations = 0;
  const base = await makeApp(t, service({
    consumeQuota: async (user) => { permitted.push(user); return null; },
    generate: async (parsed, signal) => {
      invocations += 1;
      equal(parsed.idea, brief.idea);
      ok(!signal.aborted);
      return `\`\`\`json\n${JSON.stringify(validPack)}\n\`\`\``;
    },
  }));
  deepEqual(await (await fetch(`${base}/status`)).json(), { mode: 'template', reason: 'sign-in' });
  deepEqual(await (await fetch(`${base}/status`, { headers: { Authorization: 'Bearer test-session' } })).json(), { mode: 'live' });
  equal((await post(base, brief, false)).status, 401);
  equal((await post(base, { ...brief, idea: '   ' })).status, 400);
  equal((await post(base, { ...brief, model: 'client-cannot-choose-provider' })).status, 400);
  const result = await post(base, { ...brief, idea: `  ${brief.idea}  ` });
  equal(result.status, 200);
  deepEqual(await result.json(), { pack: validPack });
  equal(invocations, 1);
  deepEqual(permitted, ['test-user']);
});

test('quota rejects requests with a retry window and fails closed if storage is down', async (t) => {
  let calls = 0;
  const base = await makeApp(t, service({
    consumeQuota: async () => { if (++calls === 1) return 60; throw new Error('Storage temporarily unavailable'); },
    generate: async () => { throw new Error('Generator must never run'); },
  }));
  const limited = await post(base);
  equal(limited.status, 429);
  equal(limited.headers.get('Retry-After'), '60');
  deepEqual(await limited.json(), { code: 'STUDIO_RATE_LIMITED' });
  const down = await post(base);
  equal(down.status, 503);
  deepEqual(await down.json(), { code: 'STUDIO_BUSY' });
});

test('invalid provider output is not echoed to the client', async (t) => {
  const base = await makeApp(t, service({ generate: async () => JSON.stringify({ ...validPack, drafts: [{ ...validPack.drafts[0], price: -100 }] }) }));
  const result = await post(base);
  equal(result.status, 502);
  deepEqual(await result.json(), { code: 'STUDIO_GENERATION_FAILED' });
});

test('provider calls receive an abort signal when their deadline expires', async (t) => {
  const base = await makeApp(t, service({ generate: (_brief, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) }), 15);
  const result = await post(base);
  equal(result.status, 504);
  deepEqual(await result.json(), { code: 'STUDIO_TIMEOUT' });
});

test('body parsing is bounded, requires authentication first, and returns safe error codes', async (t) => {
  const base = await makeApp(t, service());
  const malformed = (signedIn: boolean) => fetch(`${base}/drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signedIn ? { Authorization: 'Bearer test-session' } : {}) }, body: '{ malformed private brief' });
  const unauthorized = await malformed(false);
  equal(unauthorized.status, 401);
  const invalid = await malformed(true);
  equal(invalid.status, 400);
  deepEqual(await invalid.json(), { code: 'STUDIO_BRIEF_INVALID' });
  const large = await post(base, { ...brief, idea: 'x'.repeat(9_000) });
  equal(large.status, 413);
  deepEqual(await large.json(), { code: 'STUDIO_BRIEF_INVALID' });
});

test('only four provider calls run concurrently on an API process', { timeout: 5_000 }, async (t) => {
  let calls = 0;
  let started!: () => void;
  let finish!: () => void;
  const allStarted = new Promise<void>((resolve) => { started = resolve; });
  const waitForFinish = new Promise<void>((resolve) => { finish = resolve; });
  const base = await makeApp(t, service({ generate: async () => {
    if (++calls === 4) started();
    await waitForFinish;
    return JSON.stringify(validPack);
  } }));
  const running = Array.from({ length: 4 }, () => post(base));
  try {
    await allStarted;
    const busy = await post(base);
    equal(busy.status, 503);
    deepEqual(await busy.json(), { code: 'STUDIO_BUSY' });
    equal(calls, 4);
  } finally { finish(); await Promise.all(running); }
  const next = await post(base);
  equal(next.status, 200);
});
