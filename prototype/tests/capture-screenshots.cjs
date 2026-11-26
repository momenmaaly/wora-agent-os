/* Regenerate the review screenshots from the static prototype. */
const { chromium } = require(process.env.PLAYWRIGHT_PKG || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.WORA_PROTO_BASE || 'http://127.0.0.1:8123/index.html';
const OUT = process.env.WORA_SCREENSHOT_DIR || path.resolve(__dirname, '../../docs/experience-redesign/screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const open = async (lang, theme, hash) => {
    await page.goto(`${BASE}?lang=${lang}&theme=${theme}&v=capture${hash}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none}' });
    await page.waitForTimeout(250);
  };
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, name) });
    console.log(name);
  };

  await open('ar', 'light', '#/run/plan'); await shot('desktop-ar-light-run-plan.png');
  await open('en', 'light', '#/run/plan'); await shot('desktop-en-light-run-plan.png');
  await open('ar', 'dark', '#/run/plan'); await shot('desktop-ar-dark-run-plan.png');
  await open('en', 'dark', '#/run/evidence'); await shot('desktop-en-dark-run-evidence.png');
  await open('ar', 'light', '#/brief'); await shot('desktop-ar-light-brief.png');
  await open('ar', 'light', '#/library/artifacts'); await shot('desktop-ar-light-library-artifacts.png');
  await open('ar', 'light', '#/library/memory'); await shot('desktop-ar-light-library-memory.png');
  await open('ar', 'light', '#/library/knowledge'); await shot('desktop-ar-light-library-knowledge.png');
  await open('ar', 'light', '#/capabilities/skills'); await shot('desktop-ar-light-capabilities-skills.png');
  await page.locator('.package-row').first().click(); await page.waitForTimeout(200); await shot('desktop-ar-light-capabilities-skill-detail.png');
  await open('ar', 'light', '#/capabilities/agents');
  await page.locator('.agent-row').first().click(); await page.waitForTimeout(200); await shot('desktop-ar-light-capabilities-agent.png');
  await open('ar', 'light', '#/capabilities/plugins'); await shot('desktop-ar-light-capabilities-plugins.png');
  await open('ar', 'light', '#/capabilities/mcp'); await shot('desktop-ar-light-capabilities-mcp.png');
  await open('ar', 'light', '#/system/runtime'); await shot('desktop-ar-light-system-runtime.png');
  await open('ar', 'light', '#/system/approvals'); await shot('desktop-ar-light-system-approvals.png');
  await open('ar', 'light', '#/system/usage'); await shot('desktop-ar-light-system-usage.png');
  await open('ar', 'light', '#/run/artifact'); await shot('desktop-ar-light-run-artifact.png');
  await open('en', 'light', '#/run/plan');
  await page.locator('[data-action="open-approval"]').first().click(); await page.waitForTimeout(250); await shot('desktop-en-light-approval-sheet.png');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await mobile.newPage();
  const phoneOpen = async (lang, theme, hash) => {
    await phone.goto(`${BASE}?lang=${lang}&theme=${theme}&v=capture${hash}`, { waitUntil: 'networkidle' });
    await phone.addStyleTag({ content: 'html{scrollbar-width:none} ::-webkit-scrollbar{display:none}' });
    await phone.waitForTimeout(250);
  };
  const phoneShot = async (name) => { await phone.screenshot({ path: path.join(OUT, name) }); console.log(name); };

  await phoneOpen('ar', 'light', '#/run/plan'); await phoneShot('mobile-ar-light-run-plan.png');
  await phoneOpen('en', 'dark', '#/run/plan'); await phoneShot('mobile-en-dark-run-plan.png');
  await phoneOpen('ar', 'light', '#/run/plan'); await phone.locator('.ledger-row').last().click(); await phone.waitForTimeout(250); await phoneShot('mobile-ar-light-task-sheet.png');
  await phoneOpen('ar', 'dark', '#/run/plan'); await phone.locator('[data-action="open-approval"]').first().click(); await phone.waitForTimeout(300); await phoneShot('mobile-ar-dark-approval-sheet.png');

  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
