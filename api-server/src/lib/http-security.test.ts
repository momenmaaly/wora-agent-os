import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, isCrossSiteBrowserMutation, isStateChangingMethod } from './http-security.js';

test('cross-site browser mutations are rejected while same-origin and non-browser calls are allowed', () => {
  assert.equal(isCrossSiteBrowserMutation('POST', 'cross-site'), true);
  assert.equal(isCrossSiteBrowserMutation('DELETE', 'cross-site'), true);
  assert.equal(isCrossSiteBrowserMutation('GET', 'cross-site'), false);
  assert.equal(isCrossSiteBrowserMutation('POST', 'same-origin'), false);
  assert.equal(isCrossSiteBrowserMutation('POST', null), false);
  assert.equal(isStateChangingMethod('post'), true);
  assert.equal(isStateChangingMethod('HEAD'), false);
});

test('production origins are an exact allowlist; development permits only explicit localhost', () => {
  const allowed = new Set(['https://wora.example.invalid']);
  assert.equal(isAllowedOrigin(undefined, allowed, { production: true, allowLocalhost: false }), true);
  assert.equal(isAllowedOrigin('https://wora.example.invalid', allowed, { production: true, allowLocalhost: false }), true);
  assert.equal(isAllowedOrigin('https://evil.example.invalid', allowed, { production: true, allowLocalhost: false }), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', allowed, { production: false, allowLocalhost: true }), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', allowed, { production: true, allowLocalhost: true }), false);
});
