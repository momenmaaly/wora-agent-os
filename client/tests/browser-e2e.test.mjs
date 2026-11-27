/**
 * WORA — browser-level user journeys.
 *
 * Starts the real preview API and Vite dev server, then drives Chromium through
 * mission creation, problem understanding, plan execution, pause/resume/cancel,
 * approval, verification evidence, lessons and benchmarks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const API_PORT = 4110;
const WEB_PORT = 4175;
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
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(processHandle) {
  if (!processHandle) return;
  processHandle.child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (!processHandle.child.killed) processHandle.child.kill('SIGKILL');
}

test('browser journeys: mission, plan, workers, pause/resume/cancel, approval, evidence, lessons, benchmarks', { timeout: 180_000 }, async (t) => {
  if (!existsSync(CHROMIUM)) { t.skip(`Chromium not found at ${CHROMIUM}`); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wora-browser-e2e-'));
  let api;
  let web;
  let browser;
  try {
    api = start(process.execPath, [path.resolve(process.cwd(), '../api-server/node_modules/.bin/tsx'), 'src/scripts/preview-server.ts'], {
      cwd: path.resolve(process.cwd(), '../api-server'),
      env: { ...process.env, PORT: String(API_PORT), WORA_OS_DB: ':memory:', WORA_WORKSPACE: path.join(tmp, 'workspace'), NODE_ENV: 'development' },
    });
    await waitForUrl(`${API}/health`);

    web = start(process.execPath, [path.resolve(process.cwd(), 'node_modules/.bin/vite'), '--port', String(WEB_PORT), '--strictPort'], {
      cwd: process.cwd(),
      env: { ...process.env, WORA_API_TARGET: API },
    });
    await waitForUrl(`${WEB}/`);

    browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });

    await page.goto(`${WEB}/#execution`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /مركز التنفيذ/ }).waitFor({ timeout: 20_000 });

    const launch = async (objective) => {
      const input = page.locator('.os-launch input[aria-label="اكتب هدفك لـ WORA"]');
      await input.fill(objective);
      await page.locator('.os-launch button[type="submit"]').click();
      await page.getByRole('heading', { name: objective, exact: true }).waitFor({ timeout: 15_000 });
    };

    // 1) Create a mission and inspect its real problem profile, plan and evidence.
    await launch('Inspect my computer and identify potential problems');
    await page.getByText('فهم المشكلة واختيار الخوارزمية').waitFor({ timeout: 20_000 });
    await page.getByText('تحقق بنية الخطة').waitFor({ timeout: 20_000 });
    await page.getByText('سجل التحقق المستقل').click();
    await page.getByText('artifact-integrity').first().waitFor({ timeout: 20_000 });
    await page.getByText('العمال والعقود').click();
    await page.getByText(/لا يوجد عامل يحمل عقد مهمة الآن|worker/).first().waitFor({ timeout: 10_000 });
    await page.getByText('مكتملة', { exact: true }).first().waitFor({ timeout: 20_000 });

    // 2) Pause, resume and cancel a mission through real controls.
    await launch('Build a working web application');
    await page.getByText('بانتظار موافقتك', { exact: true }).first().waitFor({ timeout: 20_000 });
    const pause = page.getByRole('button', { name: /إيقاف مؤقت/ });
    await pause.waitFor({ timeout: 10_000 });
    await pause.click();
    await page.getByText('متوقفة مؤقتًا', { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /استئناف/ }).click();
    await page.getByText('متوقفة مؤقتًا', { exact: true }).first().waitFor({ state: 'detached', timeout: 20_000 });
    const missionListResponse = await fetch(`${API}/api/os/missions`);
    assert.equal(missionListResponse.status, 200);
    const missionList = await missionListResponse.json();
    const resumedMission = (Array.isArray(missionList) ? missionList : [])
      .filter((mission) => mission.objective === 'Build a working web application')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    assert.ok(resumedMission, 'the resumed mission must be visible through the API');
    assert.notEqual(resumedMission.status, 'paused', 'the UI resume action must change the persisted mission state');
    await page.getByText('بانتظار موافقتك', { exact: true }).first().waitFor({ timeout: 20_000 });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /إلغاء/ }).click();
    await page.getByText('ملغاة', { exact: true }).first().waitFor({ timeout: 10_000 });

    // 3) Approval-gated application build: inspect the exact payload, approve, verify.
    await launch('Build a working web application');
    await page.getByText('بانتظار موافقتك', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.getByText(/digest:/).first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /وافق ونفّذ/ }).click();
    await page.getByText('مكتملة', { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.getByText('سجل التحقق المستقل').click();
    await page.getByText('acceptance-review').first().waitFor({ timeout: 20_000 });

    // 4) Lessons: evaluate, promote, then revoke with the real admin API.
    await page.goto(`${WEB}/#intelligence`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /الذكاء التشغيلي/ }).waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: /الدروس/ }).click();
    await page.getByRole('button', { name: 'تقييم', exact: true }).first().waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'تقييم', exact: true }).first().click();
    await page.getByRole('button', { name: 'ترقية', exact: true }).first().waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'ترقية', exact: true }).first().click();
    await page.getByRole('button', { name: 'سحب', exact: true }).first().waitFor({ timeout: 20_000 });
    page.once('dialog', (dialog) => void dialog.accept('browser e2e revoke'));
    await page.getByRole('button', { name: 'سحب', exact: true }).first().click();
    await page.locator('.os-lessons .os-spec-chip').filter({ hasText: 'revoked' }).first().waitFor({ timeout: 20_000 });

    // 5) Benchmarks: run the suite and inspect the measured result.
    await page.getByRole('tab', { name: /المقاييس/ }).click();
    await page.getByRole('button', { name: /تشغيل المجموعة/ }).click();
    await page.getByText(/14\/14 ناجح/).first().waitFor({ timeout: 60_000 });

    // 6) Advanced optimization: formulate and execute a real max-flow model through the UI.
    await page.getByRole('tab', { name: /التحسين المتقدم/ }).click();
    await page.getByRole('button', { name: /صياغة وتنفيذ/ }).click();
    await page.getByRole('heading', { name: /أقصى تدفق/ }).waitFor({ timeout: 20_000 });
    await page.getByRole('heading', { name: 'تحقق مستقل' }).waitFor({ timeout: 20_000 });
    await page.getByText(/max-flow|min-cut/).first().waitFor({ timeout: 20_000 });

    // 7) Extensions: install, inspect and uninstall a real built-in skill through the UI.
    await page.goto(`${WEB}/#extensions`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /المهارات والإضافات/ }).waitFor({ timeout: 20_000 });
    await page.getByRole('tab', { name: /المهارات/ }).click();
    const skillCard = page.locator('.ext-card').filter({ hasText: 'wora.software-architecture' }).first();
    await skillCard.waitFor({ timeout: 20_000 });
    await skillCard.getByRole('button', { name: 'التفاصيل', exact: true }).click();
    const details = page.getByRole('dialog');
    await details.waitFor({ timeout: 10_000 });
    await details.getByRole('button', { name: 'تثبيت', exact: true }).click();
    const installDialog = page.getByRole('dialog');
    await installDialog.getByRole('heading', { name: /تثبيت الحزمة/ }).waitFor({ timeout: 10_000 });
    await installDialog.getByLabel('النطاق').selectOption('instance');
    const autoLoadBox = installDialog.locator('label.ext-check input[type="checkbox"]').first();
    if (await autoLoadBox.count()) await autoLoadBox.check();
    await installDialog.getByRole('button', { name: 'تثبيت', exact: true }).click();
    await page.getByText('تم التثبيت.').waitFor({ timeout: 20_000 });

    const installedCard = page.locator('.ext-card').filter({ hasText: 'wora.software-architecture' }).first();
    await installedCard.getByRole('button', { name: 'التفاصيل', exact: true }).click();
    const installedDetails = page.getByRole('dialog');
    page.once('dialog', (dialog) => void dialog.accept());
    await installedDetails.getByRole('button', { name: 'إلغاء التثبيت', exact: true }).click();
    await installedDetails.getByText('غير مثبّتة بعد.').waitFor({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // 8) Capability intelligence calls the real matcher and renders a selected capability or an honest gap.
    await page.getByRole('tab', { name: /ذكاء القدرات/ }).click();
    await page.getByLabel('صف المشكلة أو القدرة التي تحتاجها').fill('Analyze requirements and produce a verified data report');
    await page.getByRole('button', { name: 'تقييم القدرة', exact: true }).click();
    await page.getByRole('heading', { name: /القدرة المختارة|فجوة القدرات/ }).waitFor({ timeout: 20_000 });

    // 9) Experience modes: Simple asks for the objective only; Guided/Advanced expose real preflight controls.
    await page.goto(`${WEB}/#brief`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /الموجز/ }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'بسيط', exact: true }).click();
    await page.getByText('اكتب الهدف فقط. WORA يختار الطريقة والفريق والأدوات.').waitFor({ timeout: 10_000 });
    assert.equal(await page.getByRole('button', { name: 'معاينة النهج', exact: true }).count(), 0, 'Simple mode must not require an approach preview');
    assert.equal(await page.getByText('تركيب متعدد الوكلاء', { exact: true }).count(), 0, 'Simple mode must not require composition choices');
    await page.getByRole('button', { name: 'موجّه', exact: true }).click();
    await page.getByRole('button', { name: 'معاينة النهج', exact: true }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'متقدم', exact: true }).click();
    await page.getByText('اعرض المنهج العلمي والبدائل والمتطلبات والسياق التنفيذي.').waitFor({ timeout: 10_000 });
    await page.locator('textarea').first().fill('Assign three candidates to three options and minimize cost. Test data: {"costMatrix":[[12,7,9],[8,14,5],[6,9,11]],"forbidden":[{"row":0,"col":1}]}');
    await page.getByRole('button', { name: 'معاينة النهج', exact: true }).click();
    await page.getByRole('heading', { name: 'طرق مرشحة' }).waitFor({ timeout: 20_000 });
    await page.getByText('Hungarian Assignment', { exact: false }).first().waitFor({ timeout: 10_000 });
    await page.locator('.language-toggle').click();
    await page.getByRole('button', { name: 'Simple', exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
    await page.locator('.language-toggle').click();
    await page.getByRole('button', { name: 'بسيط', exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'the composer must not overflow a mobile viewport');

    assert.deepEqual(pageErrors.filter((entry) => !/favicon|socket|WebSocket/i.test(entry)), []);
  } finally {
    if (browser) await browser.close();
    await stop(web);
    await stop(api);
    rmSync(tmp, { recursive: true, force: true });
  }
});
