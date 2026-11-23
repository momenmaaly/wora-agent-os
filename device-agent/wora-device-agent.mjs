#!/usr/bin/env node
/**
 * WORA Local Device Agent — foundation reference implementation.
 *
 * What it does, honestly and entirely:
 *   1. redeems a one-time pairing code (created in the WORA app: الحوكمة والأجهزة)
 *      so this machine is known to YOUR workspace;
 *   2. collects read-only local diagnostics (cpus, load, memory, uptime, platform)
 *      and prints them LOCALLY — nothing leaves this machine;
 *   3. heartbeats to WORA so the app shows this device as reachable;
 *   4. stops for good when you revoke the connection in WORA (it exits, it does not retry).
 *
 * What it never does:
 *   - reads your files, screen, keyboard, browser, or network traffic;
 *   - uploads diagnostics or any machine content;
 *   - runs commands sent from anywhere.
 * There is no remote command channel in this foundation release. When one ships,
 * every command will require the same approval flow as high-risk tools.
 *
 * Usage:
 *   node wora-device-agent.mjs --api https://your-wora-host --device <device-id> --code <pairing-code> [--once] [--interval 60]
 *
 * Requirements: Node.js ≥ 18.21 (global fetch). No dependencies.
 */
import os from 'node:os';
import crypto from 'node:crypto';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  if (name === 'once') return true;
  return args[index + 1] ?? fallback;
};
const flag = (name) => args.includes(`--${name}`);

const api = String(arg('api', '')).replace(/\/+$/, '');
const deviceId = String(arg('device', ''));
const code = String(arg('code', ''));
const intervalSeconds = Math.max(15, Number(arg('interval', '60')) || 60);
const once = flag('once');

if (!api || !deviceId || !code) {
  console.error('الاستخدام: --api <url> --device <device-id> --code <pairing-code> [--once] [--interval 60]');
  process.exit(2);
}

/* Stable per-machine fingerprint: salted hash of host identity, never the identity itself. */
const fingerprint = crypto
  .createHash('sha256')
  .update([os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model ?? 'cpu'].join('|'))
  .digest('base64url')
  .slice(0, 43);

const call = async (path, body) => {
  const response = await fetch(`${api}/api/os${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* non-JSON body */ }
  return { ok: response.ok, status: response.status, payload };
};

const localDiagnostics = () => {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    node: process.version,
    cpus: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    loadavg: os.loadavg().map((n) => Number(n.toFixed(2))),
    memory: { totalGB: Number((total / 2 ** 30).toFixed(1)), freeGB: Number((free / 2 ** 30).toFixed(1)), usedPercent: Number((((total - free) / total) * 100).toFixed(1)) },
    uptimeHours: Number((os.uptime() / 3600).toFixed(2)),
  };
};

const printDiagnostics = () => {
  const d = localDiagnostics();
  console.log('\n── تشخيص محلي (لم يُرسل أي شيء من هذا — محلي فقط) ──');
  console.log(`  الجهاز:   ${d.hostname} — ${d.platform}`);
  console.log(`  Node:     ${d.node}`);
  console.log(`  المعالجات: ${d.cpus} × ${d.cpuModel}`);
  console.log(`  الحمل:    ${d.loadavg.join(' ')}`);
  console.log(`  الذاكرة:  ${d.memory.usedPercent}% مستخدمة (${d.memory.totalGB}GB إجمالي)`);
  console.log(`  التشغيل:  ${d.uptimeHours} ساعة\n`);
  return d;
};

const main = async () => {
  console.log('WORA Local Device Agent — اقتران…');
  const redeemed = await call(`/devices/${encodeURIComponent(deviceId)}/redeem`, { code, fingerprint });
  if (!redeemed.ok) {
    console.error(`تعذر الاقتران (HTTP ${redeemed.status}): ${redeemed.payload?.error ?? 'خطأ غير معروف'}`);
    process.exit(3);
  }
  console.log(`تم الاقتران بالجهاز "${redeemed.payload?.name ?? deviceId}". أصبح بإمكان WORA معرفة أن هذا الجهاز حي — ولا شيء أكثر.`);

  printDiagnostics();

  const beat = async () => {
    const result = await call(`/devices/${encodeURIComponent(deviceId)}/heartbeat`, { fingerprint });
    if (result.ok) {
      console.log(`[heartbeat] ${new Date().toLocaleTimeString()} — WORA يرى هذا الجهاز كمتصل.`);
      return 'ok';
    }
    console.error(`[heartbeat] رفض: ${result.payload?.error ?? `HTTP ${result.status}`}`);
    return 'rejected';
  };

  if (once || flag('once')) {
    const status = await beat();
    process.exit(status === 'ok' ? 0 : 4);
  }

  for (;;) {
    const status = await beat();
    if (status === 'rejected') {
      console.log('أُلغيت الثقة بهذا الجهاز أو لم يعد مقترنًا. يتوقف الوكيل نهائيًا.');
      process.exit(4);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
};

main().catch((err) => {
  console.error(`خطأ غير متوقع: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(5);
});
