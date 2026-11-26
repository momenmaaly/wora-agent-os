/**
 * WORA — production operating workspace journeys.
 *
 * Drives the five-zone UI against the real preview API: Brief → Run →
 * evidence/artifact → Library/memory → Capabilities. It installs a real
 * built-in skill and the official echo MCP plugin at agent scope, executes the
 * authorized plugin tool, then disables and uninstalls it and verifies the
 * agent profile no longer exposes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 4111;
const WEB_PORT = 4176;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const OBJECTIVE = 'Create a safe internal status note that summarizes the current workspace state without changing external systems';

function start(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(handle) {
  if (!handle) return;
  handle.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (!handle.child.killed) handle.child.kill('SIGKILL');
}

async function chooseTarget(dialog, name) {
  const select = dialog.getByLabel('الهدف');
  const value = await select.locator('option').filter({ hasText: name }).first().getAttribute('value');
  assert.ok(value, `target option ${name} must exist`);
  await select.selectOption(value);
}

test('production workspace: mission, evidence, memory, capability assignment, plugin execution, revocation and cleanup', { timeout: 240_000 }, async (t) => {
  if (!existsSync(CHROMIUM)) { t.skip(`Chromium not found at ${CHROMIUM}`); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wora-production-e2e-'));
  let api;
  let web;
  let browser;
  try {
    api = start(process.execPath, [path.resolve(process.cwd(), '../api-server/node_modules/.bin/tsx'), 'src/scripts/preview-server.ts'], {
      cwd: path.resolve(process.cwd(), '../api-server'),
      env: {
        ...process.env, PORT: String(API_PORT), WORA_OS_DB: ':memory:',
        WORA_WORKSPACE: path.join(tmp, 'workspace'), NODE_ENV: 'development',
        WORA_MCP_STDIO_MODE: 'official',
      },
    });
    await waitForUrl(`${API}/health`);
    web = start(process.execPath, [path.resolve(process.cwd(), 'node_modules/.bin/vite'), '--port', String(WEB_PORT), '--strictPort'], {
      cwd: process.cwd(),
      env: { ...process.env, WORA_API_TARGET: API },
    });
    await waitForUrl(`${WEB}/`);

    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });

    // 1) Brief: create a real mission from the composer.
    await page.goto(`${WEB}/#brief`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'الموجز', exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole('textbox', { name: 'ماذا تريد أن ينجز WORA؟' }).fill(OBJECTIVE);
    await page.getByRole('button', { name: 'إنشاء مهمة', exact: true }).click();
    await page.getByRole('heading', { name: OBJECTIVE, exact: true }).waitFor({ timeout: 25_000 });
    await page.getByRole('tab', { name: 'الخطة', exact: true }).waitFor();

    // 2) Run: real plan, inspector, evidence, artifact and context.
    await page.getByRole('button', { name: /Analyze the objective and extract requirements/ }).first().click();
    await page.getByText('معايير القبول', { exact: true }).waitFor();
    await page.getByText('مكتملة', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'الأدلة', exact: true }).click();
    await page.getByText('فحوصات مستقلة', { exact: true }).first().waitFor({ timeout: 25_000 });
    await page.getByRole('tab', { name: 'المخرج', exact: true }).click();
    await page.getByText('WORA Mission Deliverable').first().waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'السياق', exact: true }).click();
    await page.getByText('الفهم والتفكير', { exact: true }).first().waitFor();

    // 3) Library: artifact reader and real memory write/search.
    await page.goto(`${WEB}/#library`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'المكتبة', exact: true }).waitFor({ timeout: 20_000 });
    await page.getByText('WORA Mission Deliverable').first().waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: 'الذاكرة', exact: true }).click();
    await page.getByLabel('أضف ذكرى').fill('Production workspace verified against the real API.');
    await page.getByLabel('الوسوم (مفصولة بفواصل)').fill('production, e2e');
    await page.getByRole('button', { name: 'حفظ', exact: true }).click();
    await page.getByText('حُفظت الذكرى.').waitFor({ timeout: 20_000 });
    await page.getByPlaceholder('ابحث في الذاكرة…').fill('Production workspace');
    await page.getByText('Production workspace verified against the real API.').waitFor({ timeout: 20_000 });

    // 4) Capabilities: agents and the seven honest capability states.
    await page.goto(`${WEB}/#capabilities`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'القدرات', exact: true }).waitFor({ timeout: 20_000 });
    await page.getByText('عقل الوكيل', { exact: true }).waitFor();
    await page.getByText('أتمتة المتصفح', { exact: true }).waitFor();
    await page.getByText('غير متاحة', { exact: true }).first().waitFor();
    await page.getByRole('tab', { name: /الوكلاء/ }).click();
    await page.locator('.os-agent-card').filter({ hasText: 'Backend Engineer' }).first().waitFor({ timeout: 20_000 });

    // 5) Install a real skill at instance scope.
    await page.getByRole('tab', { name: /المهارات/ }).click();
    const skillCard = page.locator('.ext-card').filter({ hasText: 'wora.software-architecture' }).first();
    await skillCard.waitFor({ timeout: 20_000 });
    await skillCard.getByRole('button', { name: 'التفاصيل', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'تثبيت', exact: true }).click();
    let install = page.getByRole('dialog');
    await install.getByRole('heading', { name: /تثبيت الحزمة/ }).waitFor();
    await install.getByLabel('النطاق').selectOption('instance');
    const autoLoad = install.locator('label.ext-check input[type="checkbox"]').first();
    if (await autoLoad.count()) await autoLoad.check();
    const approval = install.locator('label.ext-check-warn input[type="checkbox"]');
    if (await approval.count()) await approval.check();
    await install.getByRole('button', { name: 'تثبيت', exact: true }).click();
    await page.getByText('تم التثبيت.').waitFor({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // 6) Install the official MCP plugin at agent scope and execute its tool.
    await page.getByRole('tab', { name: /الإضافات/ }).click();
    const pluginCard = page.locator('.ext-card').filter({ hasText: 'wora.echo-mcp' }).first();
    await pluginCard.waitFor({ timeout: 20_000 });
    await pluginCard.getByRole('button', { name: 'التفاصيل', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'تثبيت', exact: true }).click();
    install = page.getByRole('dialog');
    await install.getByRole('heading', { name: /تثبيت الحزمة/ }).waitFor();
    await install.getByLabel('النطاق').selectOption('agent');
    await chooseTarget(install, 'Backend Engineer');
    const pluginAutoLoad = install.locator('label.ext-check input[type="checkbox"]').first();
    if (await pluginAutoLoad.count()) await pluginAutoLoad.check();
    const pluginApproval = install.locator('label.ext-check-warn input[type="checkbox"]');
    await pluginApproval.waitFor({ timeout: 15_000 });
    await pluginApproval.check();
    await install.getByRole('button', { name: 'تثبيت', exact: true }).click();
    await page.getByText('تم التثبيت.').waitFor({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /الوكلاء/ }).click();
    const backendCard = page.locator('.os-agent-card').filter({ hasText: 'Backend Engineer' }).first();
    await backendCard.getByRole('button', { name: 'قدرات الوكيل' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByText('wora.echo-mcp@1.0.0').waitFor({ timeout: 20_000 });
    await dialog.getByText('wora.echo-mcp.echo').first().waitFor();
    await dialog.getByRole('button', { name: 'تشغيل', exact: true }).click();
    await dialog.getByText(/"ok": true/).waitFor({ timeout: 30_000 });
    await dialog.getByText(/hello/).first().waitFor();
    await page.keyboard.press('Escape');

    // 7) Disable the plugin and prove the agent profile is revoked immediately.
    await page.getByRole('tab', { name: /الإضافات/ }).click();
    await page.locator('.ext-card').filter({ hasText: 'wora.echo-mcp' }).first().getByRole('button', { name: 'التفاصيل', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'تعطيل', exact: true }).click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /الوكلاء/ }).click();
    await page.locator('.os-agent-card').filter({ hasText: 'Backend Engineer' }).first().getByRole('button', { name: 'قدرات الوكيل' }).click();
    dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await dialog.getByText('wora.echo-mcp@1.0.0').count(), 0, 'disabled plugin must not be assigned to the agent profile');
    await page.keyboard.press('Escape');

    // 8) Uninstall and verify the package is clean.
    await page.getByRole('tab', { name: /الإضافات/ }).click();
    await page.locator('.ext-card').filter({ hasText: 'wora.echo-mcp' }).first().getByRole('button', { name: 'التفاصيل', exact: true }).click();
    dialog = page.getByRole('dialog');
    page.once('dialog', (confirm) => void confirm.accept());
    await dialog.getByRole('button', { name: 'إلغاء التثبيت', exact: true }).click();
    await dialog.getByText('غير مثبّتة بعد.').waitFor({ timeout: 20_000 });

    assert.deepEqual(pageErrors.filter((entry) => !/favicon|socket|WebSocket/i.test(entry)), []);
  } finally {
    if (browser) await browser.close();
    await stop(web);
    await stop(api);
    rmSync(tmp, { recursive: true, force: true });
  }
});
