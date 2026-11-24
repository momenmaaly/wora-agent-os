#!/usr/bin/env node
/**
 * Fail the production build when the API-origin contract drifts.
 * This catches the failure mode where a static deployment sets VITE_API_URL
 * for /api but the OS and extensions clients silently keep calling the
 * frontend origin.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(clientRoot, '..');
const failures = [];

function read(relative) {
  try {
    return readFileSync(path.join(repoRoot, relative), 'utf8');
  } catch {
    failures.push(`missing ${relative}`);
    return '';
  }
}

function expect(relative, pattern, description) {
  const content = read(relative);
  if (!pattern.test(content)) failures.push(`${relative}: ${description}`);
}

expect('client/src/os/api.ts', /resolveApiBase\(import\.meta\.env\.VITE_OS_API, import\.meta\.env\.VITE_API_URL\)/u, 'OS client must fall back to VITE_API_URL');
expect('client/src/extensions/api.ts', /resolveApiBase\(import\.meta\.env\.VITE_OS_API, import\.meta\.env\.VITE_API_URL\)/u, 'extensions client must fall back to VITE_API_URL');
expect('client/src/vite-env.d.ts', /VITE_OS_API/u, 'VITE_OS_API must be typed');
expect('client/Dockerfile', /ARG VITE_API_URL/u, 'client image must accept VITE_API_URL');
expect('client/Dockerfile', /ARG VITE_OS_API/u, 'client image must accept VITE_OS_API');
expect('docker-compose.prod.yml', /VITE_API_URL:\s*\$\{VITE_API_URL:-/u, 'compose must pass VITE_API_URL');
expect('docker-compose.prod.yml', /VITE_OS_API:\s*\$\{VITE_OS_API:-/u, 'compose must pass VITE_OS_API');
expect('.env.example', /VITE_API_URL=/u, 'env example must document VITE_API_URL');
expect('.env.example', /VITE_OS_API=/u, 'env example must document VITE_OS_API');
expect('docker-compose.prod.yml', /replicas:\s*1/u, 'API must run as one SQLite writer');
if (/replicas:\s*2/u.test(read('docker-compose.prod.yml'))) failures.push('docker-compose.prod.yml: API replicas must not exceed one while using SQLite');

if (failures.length > 0) {
  console.error('API/deployment contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('API/deployment contract check passed.');
