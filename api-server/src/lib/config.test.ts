import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productionConfigProblems, sanitizeEnv } from './config.js';

const env = {
  NODE_ENV: 'production', AUTH_SECRET: 'random-fixture-test-only-not-a-real-auth-secret',
  MONGO_URI: 'mongodb://node1:27017,node2:27017/wora?replicaSet=rs0',
  REDIS_URL: 'rediss://redis.example.invalid:6380',
  ALLOWED_ORIGINS: 'https://wora.example.invalid, http://127.0.0.1:5173',
};

test('production refuses to boot without auth, persistence and explicit frontend origins', () => {
  for (const NODE_ENV of [undefined, 'production', 'staging']) {
    assert.deepEqual(productionConfigProblems({ NODE_ENV }), ['AUTH_SECRET', 'MONGO_URI', 'REDIS_URL', 'ALLOWED_ORIGINS']);
  }
  assert.deepEqual(productionConfigProblems({ ...env, AUTH_SECRET: 'change-me-to-a-strong-32-char-secret' }), ['AUTH_SECRET']);
  assert.deepEqual(productionConfigProblems({ ...env, ADMIN_API_KEY: env.AUTH_SECRET }), ['ADMIN_API_KEY']);
  assert.deepEqual(productionConfigProblems({ ...env, REDIS_URL: 'http://example.invalid', ALLOWED_ORIGINS: '*' }), ['REDIS_URL', 'ALLOWED_ORIGINS']);
  assert.deepEqual(productionConfigProblems({ ...env, ALLOWED_ORIGINS: 'https://*.example.invalid' }), ['ALLOWED_ORIGINS']);
  assert.deepEqual(productionConfigProblems({ ...env, ALLOWED_ORIGINS: 'http://example.invalid' }), ['ALLOWED_ORIGINS']);
});

test('explicit good production configuration and local development are accepted', () => {
  assert.deepEqual(productionConfigProblems(env), []);
  assert.deepEqual(productionConfigProblems({ NODE_ENV: 'development' }), []);
  assert.equal(sanitizeEnv(`MONGO_URI='${env.MONGO_URI}'`), env.MONGO_URI);
});
