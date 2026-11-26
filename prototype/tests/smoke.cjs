/* WORA experience prototype — browser smoke checks. No backend mutations. */
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');

const BASE = process.env.WORA_PROTO_BASE || 'http://127.0.0.1:8123/index.html';
const ROUTES = [
  '#/brief',
  '#/run/plan', '#/run/activity', '#/run/evidence', '#/run/artifact', '#/run/context',
  '#/library/artifacts', '#/library/memory', '#/library/knowledge',
  '#/capabilities/agents', '#/capabilities/skills', '#/capabilities/plugins', '#/capabilities/mcp',
  '#/system/runtime', '#/system/approvals', '#/system/usage'
];
const widths = [390, 1440];
const results = [];

const record = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` | ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-gpu']
  });

  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width <= 900 ? 844 : 1000 }, isMobile: width <= 900 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    for (const route of ROUTES) {
      await page.goto(`${BASE}?lang=ar&theme=light&v=smoke${route}`, { waitUntil: 'networkidle' });
      const state = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        hash: location.hash,
        activeZone: document.querySelector('.rail-zone[aria-current="page"]')?.dataset.zone || null,
        activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab || null,
        zones: document.querySelectorAll('[aria-current="page"]').length,
        unnamed: [...document.querySelectorAll('button, a, input')]
          .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()).length
      }));
      const [, routeZone, routeTab] = route.split('/');
      const ok = state.hash === route && state.activeZone === routeZone && (!routeTab || state.activeTab === routeTab) && state.scrollWidth <= state.innerWidth + 1 && state.lang === 'ar' && state.dir === 'rtl' && state.zones >= 1 && state.unnamed === 0 && !errors.length;
      record(ok, `${width}px ${route}`, errors.length ? errors[0] : `scroll ${state.scrollWidth}/${state.innerWidth}`);
    }

    // Command palette, approval sheet, focus return, and tab keyboard behavior.
    await page.goto(`${BASE}?lang=en&theme=light&v=smoke#/run/plan`, { waitUntil: 'networkidle' });
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('cap');
    const paletteResults = await page.locator('.palette-item').count();
    record(paletteResults > 0, `${width}px palette results`, String(paletteResults));
    await page.keyboard.press('Escape');

    await page.locator('[data-action="open-approval"]').first().click();
    await page.waitForTimeout(200);
    const sheet = await page.evaluate(() => ({
      open: !!document.querySelector('#sheet-root .sheet'),
      focusInside: !!document.activeElement?.closest('.sheet'),
      disabled: [...document.querySelectorAll('.sheet-foot button')].map((button) => button.disabled)
    }));
    record(sheet.open && sheet.focusInside && sheet.disabled.every(Boolean), `${width}px approval sheet`, JSON.stringify(sheet));
    await page.keyboard.press('Escape');
    const restored = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    record(restored === 'open-approval', `${width}px focus return`, String(restored));

    await page.locator('[role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const tabState = await page.evaluate(() => ({ hash: location.hash, selected: document.activeElement?.getAttribute('aria-selected') }));
    record(tabState.hash !== '#/run/plan' && tabState.selected === 'true', `${width}px keyboard tabs`, JSON.stringify(tabState));

    record(errors.length === 0, `${width}px console clean`, errors.slice(0, 2).join(' / '));
    await context.close();
  }

  await browser.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; failures ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
