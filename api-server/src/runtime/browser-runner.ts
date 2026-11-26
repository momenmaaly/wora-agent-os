/**
 * Playwright browser child process.
 *
 * The API talks to this process over newline-delimited JSON. The browser and
 * its Chromium renderer live in this child process, never in the API process.
 * The child receives no application secrets and writes only inside its
 * session-scoped directory.
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import net from 'node:net';
import { assertSafeOutboundUrl } from '../lib/safe-fetch.js';

type Request = { id: string; action: string; params?: Record<string, unknown> };
type Response = { id: string; ok: boolean; result?: unknown; error?: string };

const sessionDir = process.env['WORA_BROWSER_SESSION_DIR'] ?? process.cwd();
const screenshotDir = path.join(sessionDir, 'screenshots');
mkdirSync(screenshotDir, { recursive: true, mode: 0o700 });

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

function executablePath(): string | undefined {
  const candidates = [
    process.env['WORA_BROWSER_EXECUTABLE_PATH'],
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  ].filter((entry): entry is string => Boolean(entry));
  return candidates.find((candidate) => existsSync(candidate));
}

const proxyBridge = process.env['WORA_BROWSER_PROXY_SOCKET'];
if (proxyBridge) {
  net.createServer((client) => {
    const upstream = net.connect(proxyBridge);
    client.pipe(upstream).pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  }).listen(3128, '127.0.0.1');
}

async function ensureBrowser(): Promise<Page> {
  if (page) return page;
  const proxy = process.env['WORA_BROWSER_PROXY_URL'];
  const args = ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--disable-extensions'];
  if (process.env['WORA_BROWSER_NO_SANDBOX'] === '1') args.push('--no-sandbox');
  if (proxy) {
    args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }
  browser = await chromium.launch({ headless: true, executablePath: executablePath(), args });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  context.on('page', (candidate) => { page = candidate; });
  await context.route('**/*', async (route) => {
    try { assertSafeOutboundUrl(route.request().url()); await route.continue(); }
    catch { await route.abort('blockedbyclient'); }
  });
  page = await context.newPage();
  return page;
}

function assertNotFinancial(text: string, href = ''): void {
  const value = `${text} ${href}`;
  if (/(?:pay(?:ment)?|purchase|checkout|buy now|buy\b|place order|complete order|submit order|transfer funds|send money|withdraw|deposit|donate|subscribe|billing|invoice|credit card|debit card|card number|cvv|cvc|iban|routing number|amount due|total due|شراء|دفع|سداد|تحويل الأموال|تبرع|اشتراك|فاتورة|بطاقة)/iu.test(value)) {
    throw new Error('FINANCIAL_APPROVAL_REQUIRED: this element appears to move money. Use the approved financial action workflow; ordinary browser actions cannot complete it.');
  }
}
function assertNotFinancialField(selector: string): void {
  if (/(?:card|payment|checkout|billing|iban|account|routing|cvv|cvc|expiry|wallet|payee|recipient|amount|price|total)/iu.test(selector)) {
    throw new Error('FINANCIAL_APPROVAL_REQUIRED: this field appears to capture payment data. Use the approved financial action workflow.');
  }
}
async function isSubmitControl(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') ?? '').toLowerCase();
    return type === 'submit' || (tag === 'button' && type !== 'button') || (tag === 'input' && type === 'submit');
  }).catch(() => false);
}

async function financialFormContext(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const form = (element as HTMLInputElement).form ?? element.closest('form');
    if (!form) return '';
    const values: string[] = [form.getAttribute('action') ?? '', form.getAttribute('id') ?? '', form.getAttribute('name') ?? ''];
    for (const input of Array.from(form.querySelectorAll('input,button,[role="button"]')).slice(0, 80)) {
      const html = input as HTMLInputElement;
      values.push((input.textContent ?? '').trim(), html.value ?? '', html.name ?? '', html.id ?? '', input.getAttribute('aria-label') ?? '', input.getAttribute('title') ?? '');
    }
    return values.join(' ').replace(/\s+/gu, ' ').trim().slice(0, 4_000);
  }).catch(() => '');
}

async function inspectPage(target: Page): Promise<Record<string, unknown>> {
  const data = await target.evaluate(() => {
    const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 20_000);
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 40).map((node) => ({
      level: node.tagName.toLowerCase(), text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    })).filter((entry) => entry.text);
    const navigation = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a')).slice(0, 60).map((node) => ({
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      href: (node as HTMLAnchorElement).href,
    })).filter((entry) => entry.text);
    return { title: document.title.slice(0, 300), url: location.href, headings, navigation, text };
  });
  const markdown = [
    `# ${String(data.title || 'Untitled page')}`,
    '',
    `- Source: ${data.url}`,
    `- Inspected: ${new Date().toISOString()}`,
    '',
    '## Navigation',
    ...(data.navigation.length ? data.navigation.map((entry) => `- [${entry.text}](${entry.href})`) : ['- No navigation links found.']),
    '',
    '## Headings',
    ...(data.headings.length ? data.headings.map((entry) => `${'#'.repeat(Math.min(entry.level === 'h1' ? 2 : entry.level === 'h2' ? 3 : 4, 6))} ${entry.text}`) : ['- No headings found.']),
    '',
    '## Visible content',
    '',
    data.text || '_No visible text._',
    '',
  ].join('\n');
  return { ...data, markdown };
}

async function handle(request: Request): Promise<unknown> {
  const p = request.params ?? {};
  const target = await ensureBrowser();
  if (request.action === 'open') {
    const url = assertSafeOutboundUrl(String(p['url'] ?? ''));
    const response = await target.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: Math.min(Number(p['timeoutMs'] ?? 20_000), 60_000) });
    await target.waitForTimeout(300);
    return { status: response?.status() ?? null, ...(await inspectPage(target)) };
  }
  if (request.action === 'inspect') return inspectPage(target);
  if (request.action === 'screenshot') {
    await ensureBrowser();
    const name = `screenshot-${Date.now()}.png`;
    const file = path.join(screenshotDir, name);
    const passwordFields = target.locator('input[type="password"]');
    const mask = (await passwordFields.count()) > 0 ? [passwordFields] : [];
    await target.screenshot({ path: file, fullPage: p['fullPage'] !== false, mask });
    return { path: path.relative(sessionDir, file), bytes: statSync(file).size, url: target.url(), title: await target.title(), capturedAt: new Date().toISOString() };
  }
  if (request.action === 'click') {
    const selector = typeof p['selector'] === 'string' ? p['selector'] : null;
    const text = typeof p['text'] === 'string' ? p['text'] : null;
    const locator = selector ? target.locator(selector).first() : text ? target.getByText(text, { exact: false }).first() : null;
    if (!locator) throw new Error('click requires selector or text');
    const label = (await locator.innerText().catch(() => '')) || '';
    const href = await locator.getAttribute('href').catch(() => null) ?? '';
    const attributes = [await locator.getAttribute('value').catch(() => null), await locator.getAttribute('aria-label').catch(() => null), await locator.getAttribute('title').catch(() => null)].filter(Boolean).join(' ');
    if (p['financialApproved'] !== true) {
      assertNotFinancial(`${label} ${attributes} ${text ?? ''}`, href);
      if (await isSubmitControl(locator)) {
        const formContext = await financialFormContext(locator);
        assertNotFinancial(formContext);
        assertNotFinancialField(formContext);
      }
    }
    await locator.click({ timeout: Math.min(Number(p['timeoutMs'] ?? 10_000), 30_000) });
    await target.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
    return { clicked: label.slice(0, 300) || selector || text, ...(await inspectPage(target)) };
  }
  if (request.action === 'type') {
    const selector = String(p['selector'] ?? '');
    if (!selector) throw new Error('type requires selector');
    if (p['financialApproved'] !== true) assertNotFinancialField(selector);
    const locator = target.locator(selector).first();
    await locator.fill(String(p['text'] ?? ''), { timeout: Math.min(Number(p['timeoutMs'] ?? 10_000), 30_000) });
    if (p['submit'] === true) {
      if (p['financialApproved'] !== true) {
        const formContext = await financialFormContext(locator);
        assertNotFinancial(`${selector} ${String(p['text'] ?? '')} ${formContext}`);
        assertNotFinancialField(formContext);
      }
      await locator.press('Enter');
    }
    return { typed: true, selector, submitted: p['submit'] === true, url: target.url() };
  }
  if (request.action === 'select') {
    const selector = String(p['selector'] ?? '');
    const value = String(p['value'] ?? '');
    if (!selector || !value) throw new Error('select requires selector and value');
    const locator = target.locator(selector).first();
    if (p['financialApproved'] !== true) {
      const optionLabel = await locator.locator(`option[value=${JSON.stringify(value)}]`).first().innerText().catch(() => '');
      assertNotFinancialField(selector);
      assertNotFinancial(`${value} ${optionLabel}`);
    }
    await locator.selectOption(value);
    return { selected: value, selector };
  }
  if (request.action === 'scroll') {
    const delta = Number(p['delta'] ?? 600);
    await target.mouse.wheel(0, delta);
    await target.waitForTimeout(250);
    return { scrolled: delta, url: target.url() };
  }
  if (request.action === 'wait') {
    const timeoutMs = Math.min(Math.max(Number(p['timeoutMs'] ?? 1_000), 100), 30_000);
    await target.waitForTimeout(timeoutMs);
    return { waitedMs: timeoutMs, url: target.url(), title: await target.title() };
  }
  if (request.action === 'close') {
    await browser?.close().catch(() => undefined);
    browser = null; context = null; page = null;
    return { closed: true };
  }
  if (request.action === 'ping') return { pong: true, url: target.url() };
  throw new Error(`Unknown browser action: ${request.action}`);
}

function send(response: Response): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let request: Request;
  try { request = JSON.parse(line) as Request; } catch { return; }
  void handle(request).then((result) => send({ id: request.id, ok: true, result }))
    .catch((error: unknown) => send({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
});
rl.on('close', () => { void browser?.close().catch(() => undefined).finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void browser?.close().catch(() => undefined).finally(() => process.exit(0)); });
process.on('SIGINT', () => { void browser?.close().catch(() => undefined).finally(() => process.exit(0)); });
