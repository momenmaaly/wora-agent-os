import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBase } from '../src/lib/apiBase.ts';

test('api base: same-origin, shared fallback and OS override resolve predictably', () => {
  assert.equal(resolveApiBase(undefined, undefined), '');
  assert.equal(resolveApiBase('', ''), '');
  assert.equal(resolveApiBase(undefined, 'https://api.example.com/'), 'https://api.example.com');
  assert.equal(resolveApiBase('https://os.example.com', 'https://api.example.com'), 'https://os.example.com');
  assert.equal(resolveApiBase('  https://os.example.com/  ', 'https://api.example.com'), 'https://os.example.com');
});

test('api base: rejects credentials, paths, non-http schemes and malformed origins', () => {
  assert.throws(() => resolveApiBase('https://user:pass@example.com'), /credentials/u);
  assert.throws(() => resolveApiBase('https://example.com/api'), /without a path/u);
  assert.throws(() => resolveApiBase('https://example.com?x=1'), /without a path/u);
  assert.throws(() => resolveApiBase('ftp://example.com'), /http or https/u);
  assert.throws(() => resolveApiBase('not-a-url'), /absolute http\(s\) URL/u);
});
