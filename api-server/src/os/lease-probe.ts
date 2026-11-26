/** Test-only process used to verify cross-process SQLite lease behavior. */
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { acquireWriterLease, ensureWriterLeaseTable, renewWriterLease } from './db.js';

const [dbPath, owner, mode, barrier] = process.argv.slice(2);
if (!dbPath || !owner || !mode || !barrier) throw new Error('usage: lease-probe <db> <owner> <acquire|hold> <barrier>');

const waitFor = async (file: string) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
};

const db = new DatabaseSync(dbPath);
ensureWriterLeaseTable(db);
try {
  if (mode === 'acquire') {
    await waitFor(barrier);
    try {
      acquireWriterLease(db, { ownerId: owner, host: 'probe', pid: process.pid, ttlMs: 5_000 });
      process.stdout.write('ACQUIRED\n');
    } catch (error) {
      process.stdout.write(`DENIED:${error instanceof Error ? error.message : 'unknown'}\n`);
      process.exitCode = 2;
    }
  } else if (mode === 'hold') {
    acquireWriterLease(db, { ownerId: owner, host: 'probe', pid: process.pid, ttlMs: 300 });
    process.stdout.write('ACQUIRED\n');
    await waitFor(barrier);
    const renewed = renewWriterLease(db, owner, Date.now(), 5_000);
    process.stdout.write(`RENEW:${renewed}\n`);
    writeFileSync(`${barrier}.done`, 'done');
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
} finally {
  db.close();
}
