/**
 * WORA cloud computer & browser — UI against the real preview API.
 *
 * Starts a real browser session from the RuntimePanel, drives it through the
 * runtime API, refreshes the panel and verifies the real screenshot renders and
 * can be stopped. A local HTTP page is used so no external service is needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 4112;
const WEB_PORT = 4178;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
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
    try { const response = await fetch(url); if (response.ok) return; } catch { /* not ready */ }
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

test('runtime panel starts a real browser, renders a real screenshot and stops it', { timeout: 180_000 }, async (t) => {
  if (!existsSync(CHROMIUM)) { t.skip(`Chromium not found at ${CHROMIUM}`); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wora-runtime-ui-'));
  const docServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>WORA runtime UI page</title></head><body><h1>Runtime UI evidence</h1><p>Captured by a real Chromium child.</p></body></html>');
  });
  await new Promise((resolve) => docServer.listen(0, '127.0.0.1', resolve));
  const docPort = docServer.address().port;
  let api;
  let web;
  let browser;
  try {
    api = start(process.execPath, [path.resolve(process.cwd(), '../api-server/node_modules/.bin/tsx'), 'src/scripts/preview-server.ts'], {
      cwd: path.resolve(process.cwd(), '../api-server'),
      env: {
        ...process.env, PORT: String(API_PORT), WORA_OS_DB: ':memory:',
        WORA_WORKSPACE: path.join(tmp, 'workspace'), WORA_RUNTIME_ROOT: path.join(tmp, 'runtime'),
        WORA_BROWSER_EXECUTABLE_PATH: CHROMIUM, WORA_BROWSER_PROVIDER: 'process', WORA_ALLOW_PRIVATE_OUTBOUND_FOR_TESTS: '1',
        WORA_TEST_ALLOWED_PORTS: String(docPort), NODE_ENV: 'test',
      },
    });
    await waitForUrl(`${API}/health`);
    web = start(process.execPath, [path.resolve(process.cwd(), 'node_modules/.bin/vite'), '--port', String(WEB_PORT), '--strictPort'], {
      cwd: process.cwd(), env: { ...process.env, WORA_API_TARGET: API },
    });
    await waitForUrl(`${WEB}/`);
    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });

    await page.goto(`${WEB}/#brief`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'الموجز', exact: true }).waitFor({ timeout: 20_000 });
    const panel = page.locator('.runtime-panel');
    await panel.locator('.runtime-availability span[data-state]').first().waitFor({ timeout: 20_000 });
    await panel.getByRole('button', { name: 'بدء متصفح', exact: true }).click();
    await panel.getByText(/جلسة متصفح · running/u).waitFor({ timeout: 30_000 });

    const sessions = await (await fetch(`${API}/api/os/runtime/sessions`)).json();
    const session = sessions.browser.find((entry) => entry.status === 'running');
    assert.ok(session, 'a real browser session is running');
    const open = await fetch(`${API}/api/os/runtime/sessions/${session.id}/browser`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'open', url: `http://127.0.0.1:${docPort}/` }),
    });
    assert.equal(open.status, 200);
    const shot = await fetch(`${API}/api/os/runtime/sessions/${session.id}/browser`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'screenshot', fullPage: true }),
    });
    assert.equal(shot.status, 200);
    const shotBody = await shot.json();
    assert.ok(shotBody.bytes > 0);

    await panel.locator('.icon-button').click();
    await panel.locator('.runtime-shot img').first().waitFor({ timeout: 20_000 });
    const imageBox = await panel.locator('.runtime-shot img').first().boundingBox();
    assert.ok(imageBox && imageBox.width > 20 && imageBox.height > 20);

    await panel.getByRole('button', { name: 'إيقاف', exact: true }).click();
    await panel.getByText(/جلسة متصفح · stopped/u).waitFor({ timeout: 20_000 });
    assert.deepEqual(pageErrors.filter((entry) => !/favicon|socket|WebSocket/i.test(entry)), []);
  } finally {
    if (browser) await browser.close();
    await stop(web);
    await stop(api);
    docServer.closeAllConnections();
    await new Promise((resolve) => docServer.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});
