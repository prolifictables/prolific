// Run with: node tests/web-php-pin-login.cjs (no network or database access).
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { loadEnv } = require('vite');
const root = path.resolve(__dirname, '..');
const env = loadEnv('production', root, 'VITE_');
function load(overrides = {}) {
  const { outputFiles } = buildSync({
    entryPoints: [path.join(root, 'src/lib/remote-auth.ts')], bundle: true,
    write: false, format: 'cjs', platform: 'browser',
    define: { 'import.meta.env': JSON.stringify({ ...env, ...overrides }) },
  });
  const calls = [];
  const context = {
    module: { exports: {} }, console, setTimeout, clearTimeout, AbortController, Response,
    localStorage: { getItem: () => null },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      return new Response(JSON.stringify({ success: true, data: { verified: true } }));
    },
  };
  vm.runInNewContext(outputFiles[0].text, context);
  return { login: context.module.exports.pinLogin, calls };
}
(async () => {
  const { login, calls } = load();
  await login({ pin: '9876' });
  await login({ pin: '9876', branchId: 'stale-branch', deviceId: 'stale-device' });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://prolifictables.com/api/v1/auth/pin/login');
    assert.equal(call.method, 'POST');
    assert.deepEqual(JSON.parse(call.body), {
      pin: '9876', branchId: '6a928ddd4847242a42add1b2', deviceId: '6a928de54847242a42add1d0',
    });
  }
  const missing = load({ VITE_DEFAULT_BRANCH_ID: '' });
  await assert.rejects(missing.login({ pin: '9876' }), /configured branch ID/);
  assert.equal(missing.calls.length, 0);
  console.log('PASS: production PIN request carries configured branch/device; missing branch fails before HTTP.');
})().catch(error => { console.error(error); process.exitCode = 1; });
