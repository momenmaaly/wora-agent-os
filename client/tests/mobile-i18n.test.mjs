/**
 * Real mobile RTL/LTR acceptance: Arabic is the default direction, the language
 * toggle switches to English/LTR, and the execution workspace does not overflow
 * a 390×844 viewport.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 4112;
const WEB_PORT = 4177;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';

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
    try { if ((await fetch(url)).ok) return; } catch { /* not ready */ }
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

test('mobile Arabic RTL and English LTR remain usable without horizontal overflow', { timeout: 120_000 }, async (t) => {
  if (!existsSync(CHROMIUM)) { t.skip(`Chromium not found at ${CHROMIUM}`); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wora-mobile-i18n-'));
  let api;
  let web;
  let browser;
  try {
    api = start(process.execPath, [path.resolve(process.cwd(), '../api-server/node_modules/.bin/tsx'), 'src/scripts/preview-server.ts'], {
      cwd: path.resolve(process.cwd(), '../api-server'),
      env: { ...process.env, PORT: String(API_PORT), WORA_OS_DB: ':memory:', WORA_WORKSPACE: path.join(tmp, 'workspace'), NODE_ENV: 'development' },
    });
    await waitForUrl(`http://127.0.0.1:${API_PORT}/health`);
    web = start(process.execPath, [path.resolve(process.cwd(), 'node_modules/.bin/vite'), '--port', String(WEB_PORT), '--strictPort'], {
      cwd: process.cwd(), env: { ...process.env, WORA_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    });
    await waitForUrl(`http://127.0.0.1:${WEB_PORT}/`);

    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${WEB_PORT}/#execution`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /مركز التنفيذ/ }).waitFor({ timeout: 20_000 });
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    const arabicOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(arabicOverflow <= 1, `Arabic mobile overflowed by ${arabicOverflow}px`);

    await page.locator('.language-toggle').click();
    await page.getByRole('heading', { name: /Execution Center/ }).waitFor({ timeout: 20_000 });
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    const englishOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(englishOverflow <= 1, `English mobile overflowed by ${englishOverflow}px`);
  } finally {
    await browser?.close().catch(() => undefined);
    await stop(web);
    await stop(api);
    rmSync(tmp, { recursive: true, force: true });
  }
});
