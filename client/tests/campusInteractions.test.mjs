import { ok, equal } from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

/*
 * DOM-level interaction regression for the workspace-first Campus shell.
 * WebGL is intentionally unavailable in jsdom, so this exercises the preserved
 * SVG fallback, real drawer controls, recorded handoff commands, and department
 * navigation. WebGL raycasting itself is covered by the pure layout/motion tests
 * and by the production build; no screenshot is used as proof of interaction.
 */
test('Campus controls perform real workspace actions and department navigation', async (t) => {
  const dom = new JSDOM('<!doctype html><html lang="ar" dir="rtl"><body><div id="root"></div><main id="main-content"></main></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.matchMedia = () => ({ matches: false, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = window.matchMedia;
  globalThis.ResizeObserver = window.ResizeObserver;
  for (const key of ['HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'getComputedStyle']) {
    globalThis[key] = typeof window[key] === 'function' && key === 'getComputedStyle' ? window[key].bind(window) : window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const rootPath = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({
    root: rootPath,
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  t.after(async () => {
    await server.close();
    window.close();
  });

  const { Campus } = await server.ssrLoadModule('/src/components/Campus.tsx');
  const { useWoraStore } = await server.ssrLoadModule('/src/store/useWoraStore.ts');
  const initialActivity = useWoraStore.getState().activityLog.length;
  const visits = [];
  let assigns = 0;
  const container = window.document.getElementById('root');
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(Campus, {
      roomId: null,
      tourIndex: null,
      onVisit: (id) => visits.push(id),
      onAssign: () => { assigns += 1; },
      onDirector: () => {},
    }));
  });

  function click(element) {
    ok(element, 'interaction target exists');
    return act(async () => {
      element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  // The SVG fallback remains available; a department click navigates into its workspace.
  const svgRoom = container.querySelector('[data-room="zone-product"]');
  ok(svgRoom, 'interactive SVG office department is rendered');
  await click(svgRoom);
  ok(visits.includes('zone-product'), 'department click triggers real room navigation');

  // Entering a department opens its team workspace; the header toggle can close and reopen it.
  ok(container.querySelector('[data-testid="campus-drawer"]'), 'department click opens the team drawer');
  await click(container.querySelector('[aria-label="إغلاق اللوحة"]'));
  ok(!container.querySelector('[data-testid="campus-drawer"]'), 'drawer close performs a real UI action');
  await click(container.querySelector('[data-testid="campus-team-button"]'));
  ok(container.querySelector('[data-testid="campus-drawer"]'), 'team button reopens the drawer');
  const handoff = container.querySelector('[data-testid="office-handoff-button"]');
  ok(handoff && !handoff.disabled, 'handoff action is available with the preserved roster');
  await click(handoff);
  const command = useWoraStore.getState().officeCommand;
  equal(command?.kind, 'handoff');
  ok(command?.fromAgentId && command?.toAgentId && command.fromAgentId !== command.toAgentId);
  ok(useWoraStore.getState().activityLog.length > initialActivity, 'handoff is recorded in the activity log');
  ok(container.textContent.includes('تم تسجيل أمر التحويل'), 'handoff gives grounded user feedback');

  // Activity drawer shows the recorded event, not fabricated dashboard data.
  await click(container.querySelector('[data-testid="campus-activity-button"]'));
  const activity = container.querySelector('.campus-activity-list');
  ok(activity, 'activity drawer opens');
  ok(activity.textContent.includes('أمر تحويل بين الوكلاء'), 'activity drawer contains the recorded handoff');

  // The department picker is wired to the existing hash navigation path.
  const picker = container.querySelector('#office-department-picker');
  ok(picker, 'department picker exists');
  await act(async () => {
    picker.value = 'zone-engineering';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  ok(visits.includes('zone-engineering'), 'department picker triggers real navigation');

  // Assignment button remains a real action after the redesign.
  await click(container.querySelector('.campus-header-actions .button.primary'));
  equal(assigns, 1);

  await act(async () => { root.unmount(); });
});
