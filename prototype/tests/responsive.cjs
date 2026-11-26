/* Width sweep for the static prototype. */
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const BASE = process.env.WORA_PROTO_BASE || 'http://127.0.0.1:8123/index.html';
const ROUTES = ['#/run/plan', '#/capabilities/skills', '#/library/memory', '#/system/approvals'];
const WIDTHS = [1920, 1440, 1280, 1101, 1024, 900, 768, 390];
let failed = 0;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: width <= 900 ? 844 : 1000 }, isMobile: width <= 900 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    for (const route of ROUTES) {
      await page.goto(`${BASE}?lang=ar&theme=light&v=width${route}`, { waitUntil: 'networkidle' });
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        inspector: getComputedStyle(document.querySelector('.inspector')).display,
        mobileNav: getComputedStyle(document.querySelector('.mobile-nav')).display
      }));
      const expected = width <= 900
        ? state.mobileNav !== 'none' && state.inspector === 'none'
        : width <= 1100 ? state.inspector === 'none' : state.inspector !== 'none';
      const ok = state.overflow <= 1 && expected && !errors.length;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}px ${route} | overflow ${state.overflow} | inspector ${state.inspector} | mobile-nav ${state.mobileNav}${errors.length ? ` | ${errors[0]}` : ''}`);
    }
    await context.close();
  }
  await browser.close();
  console.log(`\n${failed ? 'FAIL' : 'ok'} width sweep failures ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
