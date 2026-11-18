import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
Object.defineProperty(globalThis, 'window', { value: { localStorage } });
const { makeTemplatePack, margin, packAsText, STUDIO_EXAMPLES } = await import('../src/studio/drafts.ts');
const { STUDIO_HISTORY_LIMIT, useStudioStore } = await import('../src/studio/useStudioStore.ts');
const { studioSaveState, useProjectStore } = await import('../src/store/useProjectStore.ts');

const brief = STUDIO_EXAMPLES[0].brief;
const pack = makeTemplatePack(brief);
const item = pack.drafts[0];
const projectA = 'proj-1';
const projectB = 'proj-2';
const getLinked = () => useProjectStore.getState().products.filter((product) => product.studioRef);

beforeEach(() => {
  useStudioStore.setState(useStudioStore.getInitialState(), true);
  useProjectStore.setState(useProjectStore.getInitialState(), true);
});

test('local packs follow the brief and price position, and export reviewed USD estimates', () => {
  const accessible = makeTemplatePack({ ...brief, positioning: 'accessible' });
  const premium = makeTemplatePack({ ...brief, positioning: 'premium' });
  equal(premium.drafts.length, 3);
  equal(premium.launch.actions.length, 3);
  match(premium.summary, /عشّاق تحضير القهوة/);
  ok(premium.drafts[0].price > accessible.drafts[0].price);
  equal(margin({ ...item, price: 0 }), null);
  const edited = { ...item, name: 'قهوة الصباح', price: 25.95, cost: 14.65 };
  equal(margin(edited), 44);
  const exported = packAsText(brief, { ...pack, drafts: [edited, ...pack.drafts.slice(1)] }, 'template');
  for (const text of ['قالب معاينة', 'قهوة الصباح', '$25.95', '$14.65', '44%', 'خطة مراجعة قبل الإطلاق']) ok(exported.includes(text), text);
});

test('history persists and bounds Studio packs; selecting and removing a pack preserves other edits', async () => {
  const studio = useStudioStore.getState();
  studio.setBrief(brief);
  for (let i = 0; i < STUDIO_HISTORY_LIMIT + 1; i++) studio.addSession(brief, { ...pack, title: `حزمة ${i}` }, 'template');
  const { sessions, activeId } = useStudioStore.getState();
  equal(sessions.length, STUDIO_HISTORY_LIMIT);
  equal(sessions.at(-1).pack.title, 'حزمة 1');
  equal(activeId, sessions[0].id);
  const other = sessions[1].id;
  studio.editDraft(other, 0, { ...item, name: 'مسودة مُراجعة' });
  studio.selectSession(other);
  const saved = storage.get('wora:studio:v1');
  useStudioStore.setState(useStudioStore.getInitialState(), true);
  storage.set('wora:studio:v1', saved);
  await useStudioStore.persist.rehydrate();
  equal(useStudioStore.getState().activeId, other);
  equal(useStudioStore.getState().sessions[1].pack.drafts[0].name, 'مسودة مُراجعة');
  deepEqual(useStudioStore.getState().brief, brief);
  studio.deleteSession(other);
  equal(useStudioStore.getState().activeId, sessions[0].id);
  equal(useStudioStore.getState().sessions.length, STUDIO_HISTORY_LIMIT - 1);
});

test('saving an edited draft explicitly updates its project copy without duplicates', () => {
  const { saveStudioDrafts, updateProduct } = useProjectStore.getState();
  const items = new Map([[0, item]]);
  deepEqual(saveStudioDrafts(projectA, 'pack-1', items, 100), { ok: true, added: 1, updated: 0 });
  const [original] = getLinked();
  equal(original.status, 'draft');
  equal(original.stock, 0);
  const edited = { ...item, price: 25.95, name: 'قهوة مُراجعة' };
  equal(studioSaveState(edited, original), 'changed');
  deepEqual(saveStudioDrafts(projectA, 'pack-1', new Map([[0, edited]]), 4), { ok: true, added: 0, updated: 1 });
  equal(getLinked()[0].id, original.id);
  equal(getLinked()[0].name, edited.name);
  equal(studioSaveState(edited, getLinked()[0]), 'saved');
  deepEqual(saveStudioDrafts(projectA, 'pack-1', new Map([[0, edited]]), 4), { ok: true, added: 0, updated: 0 });
  updateProduct(original.id, { status: 'active' });
  saveStudioDrafts(projectA, 'pack-1', items, 100);
  equal(getLinked()[0].name, edited.name, 'never overwrite products moved out of draft status');
  equal(getLinked()[0].status, 'active');
  saveStudioDrafts(projectB, 'pack-1', items, 100);
  equal(getLinked().length, 2, 'a different project receives a separate copy');
});

test('batch saves respect the product limit atomically and reject a missing destination', () => {
  const { saveStudioDrafts, products } = useProjectStore.getState();
  const drafts = new Map(pack.drafts.map((draft, i) => [i, draft]));
  deepEqual(saveStudioDrafts('missing', 'pack-1', drafts, 100), { ok: false, reason: 'project' });
  deepEqual(saveStudioDrafts(projectA, 'pack-1', drafts, products.length + 2), { ok: false, reason: 'limit' });
  equal(getLinked().length, 0);
  deepEqual(saveStudioDrafts(projectA, 'pack-1', drafts, products.length + 3), { ok: true, added: 3, updated: 0 });
  equal(getLinked().length, 3);
  equal(useProjectStore.getState().projects.find((project) => project.id === projectA).stats.products, products.length + 3);
});
