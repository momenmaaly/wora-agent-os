/**
 * WORA — experience levels against the real preview API.
 *
 * Simple is the default. Guided previews the actual problem/plan/team before
 * launch. Advanced exposes scientific rationale and the Run context inspector.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 4113;
const WEB_PORT = 4179;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const OBJECTIVE = 'Optimize employee shift schedule under cost constraints';

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

test('experience modes: simple default, guided real preflight, advanced disclosure and Run context', { timeout: 180_000 }, async (t) => {
  if (!existsSync(CHROMIUM)) { t.skip(`Chromium not found at ${CHROMIUM}`); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wora-experience-modes-'));
  let api;
  let web;
  let browser;
  try {
    api = start(process.execPath, [path.resolve(process.cwd(), '../api-server/node_modules/.bin/tsx'), 'src/scripts/preview-server.ts'], {
      cwd: path.resolve(process.cwd(), '../api-server'),
      env: {
        ...process.env, PORT: String(API_PORT), WORA_OS_DB: ':memory:',
        WORA_WORKSPACE: path.join(tmp, 'workspace'), NODE_ENV: 'development',
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

    await page.goto(`${WEB}/#brief`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'الموجز', exact: true }).waitFor({ timeout: 20_000 });

    const modes = page.getByRole('group', { name: 'مستوى التجربة' });
    assert.equal(await modes.getByRole('button', { name: 'بسيط', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'معاينة النهج', exact: true }).count(), 0, 'Simple must not expose preflight controls');

    await page.getByRole('textbox', { name: 'ماذا تريد أن ينجز WORA؟' }).fill(OBJECTIVE);
    await modes.getByRole('button', { name: 'موجّه', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة النهج', exact: true }).click();
    const preview = page.locator('.op-approach');
    await preview.waitFor({ timeout: 25_000 });
    assert.equal(await preview.getAttribute('data-domain'), 'operations_research');
    await preview.getByText('Employee Shift Scheduling MIP', { exact: true }).waitFor();
    await preview.getByText('Operations Research Specialist', { exact: true }).waitFor();
    assert.ok(await preview.locator('.op-approach-plan li').count() > 0, 'the real plan must be shown');
    assert.equal(await page.locator('.op-mission-list li').count(), 0, 'preview must not create a mission');

    await modes.getByRole('button', { name: 'متقدم', exact: true }).click();
    await page.getByText('المنهج العلمي', { exact: true }).waitFor();
    await page.getByText('بدائل مرفوضة', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'إنشاء مهمة', exact: true }).click();
    await page.getByRole('heading', { name: OBJECTIVE, exact: true }).waitFor({ timeout: 25_000 });
    await page.getByRole('tab', { name: 'الخطة', exact: true }).waitFor();

    const runModes = page.getByRole('group', { name: 'مستوى التجربة' });
    await runModes.getByRole('button', { name: 'بسيط', exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('tab', { name: 'السياق', exact: true }).count(), 0, 'Simple must hide the raw context inspector');

    await runModes.getByRole('button', { name: 'متقدم', exact: true }).click();
    await page.getByRole('tab', { name: 'السياق', exact: true }).waitFor();

    assert.deepEqual(pageErrors.filter((entry) => !/favicon|socket|WebSocket/i.test(entry)), []);
  } finally {
    if (browser) await browser.close();
    await stop(web);
    await stop(api);
    rmSync(tmp, { recursive: true, force: true });
  }
});
