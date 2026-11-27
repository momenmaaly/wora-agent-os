import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productionConfigProblems, productionRuntimeConfigProblems, sanitizeEnv } from './config.js';

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

const runtimeEnv = {
  NODE_ENV: 'production', WORA_CLOUD_PROVIDER: 'docker', WORA_BROWSER_PROVIDER: 'docker',
  DOCKER_HOST: 'tcp://runtime-docker:2376', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/certs/client',
  WORA_RUNTIME_ROOT: '/app/data/runtime', WORA_OS_DB: '/app/data/wora-os.db',
  WORA_SECRET_KEY_FILE: '/app/data/.wora-secret-key',
};

test('production runtime requires an explicit isolated provider and secure runtime settings', () => {
  assert.deepEqual(productionRuntimeConfigProblems(runtimeEnv), []);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, WORA_CLOUD_PROVIDER: 'process' }), ['WORA_CLOUD_PROVIDER=docker']);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, WORA_CLOUD_ALLOW_PROCESS_PROVIDER: '1' }), ['WORA_CLOUD_ALLOW_PROCESS_PROVIDER']);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, WORA_BROWSER_PROVIDER: 'process' }), ['WORA_BROWSER_PROVIDER=docker']);
  assert.ok(productionRuntimeConfigProblems({ ...runtimeEnv, DOCKER_HOST: 'unix:///var/run/docker.sock' }).length === 1);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, DOCKER_HOST: 'tcp://runtime-docker:2376', DOCKER_TLS_VERIFY: '' }), ['DOCKER_TLS_VERIFY=1']);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, WORA_RUNTIME_ROOT: 'data/runtime' }), ['WORA_RUNTIME_ROOT (absolute path required)']);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, WORA_OS_DB: ':memory:' }), ['WORA_OS_DB (file-backed database required)']);
  assert.deepEqual(productionRuntimeConfigProblems({ ...runtimeEnv, WORA_SECRET_KEY_FILE: '' }), ['WORA_SECRET_KEYS, WORA_SECRET_KEY or WORA_SECRET_KEY_FILE']);
  assert.deepEqual(productionRuntimeConfigProblems({ NODE_ENV: 'development' }), []);
});
