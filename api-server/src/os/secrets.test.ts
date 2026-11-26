import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from './secrets.js';

test('known credential signatures and secret-named env values are redacted recursively', () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const envToken = 'env-secret-value-12345';
  const result = redactSecrets({
    nested: { text: `Authorization: Bearer ${token}` },
    list: [`sk-${'a'.repeat(32)}`, 'ordinary prose'],
    env: `value=${envToken}`,
  }, { env: { TEST_SECRET_TOKEN: envToken, SAFE_VALUE: 'ordinary' } });
  const text = JSON.stringify(result.value);
  assert.ok(!text.includes(token));
  assert.ok(!text.includes('sk-' + 'a'.repeat(32)));
  assert.ok(!text.includes(envToken));
  assert.match(text, /\[REDACTED:github-token\]/);
  assert.match(text, /\[REDACTED:env:TEST_SECRET_TOKEN\]/);
  assert.ok(result.redactions.includes('github-token'));
  assert.ok(result.redactions.includes('env:TEST_SECRET_TOKEN'));
});

test('redaction does not mutate the source object or ordinary text', () => {
  const source = { value: 'nothing secret here', nested: { keep: 42 } };
  const result = redactSecrets(source);
  assert.equal(result.value.value, 'nothing secret here');
  assert.equal(result.value.nested.keep, 42);
  assert.equal(source.value, 'nothing secret here');
});
