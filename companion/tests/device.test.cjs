const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceLink } = require('../lib/device.cjs');
const device = { enabled: true, address: '192.168.1.100', token: 'test-only' };
const view = { action: 'idle', text: '你好', source: { id: 'mac' }, sources: [{ id: 'mac' }], mode: 'mac', rotationSeconds: 15 };

test('a reset during periodic state delivery retries the same sequence once', async t => {
  const link = new DeviceLink(), requests = [];
  link.latest = { status: 'ready', supported: true };
  link.lastProbe = Date.now();
  link.settingsDirty = false;
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push({ url, body: options.body });
    if (requests.length === 1) throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } });
    return new Response('{"ok":true}', { status: 200 });
  });
  await link.tick(device, view, false);
  assert.equal(link.latest.status, 'ready');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body, requests[0].body, 'retry must preserve the bridge and sequence for device deduplication');
  assert.equal(link.sequence, 1);
});

test('a persistent reset has bounded retries and reports a connection failure', async t => {
  const link = new DeviceLink(); let calls = 0;
  link.latest = { status: 'ready', supported: true };
  link.lastProbe = Date.now(); link.settingsDirty = false;
  t.mock.method(global, 'fetch', async () => { calls++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); });
  await link.tick(device, view, false);
  assert.equal(calls, 2);
  assert.equal(link.latest.status, 'unreachable');
  assert.equal(link.latest.diagnostic_code, 'ECONNRESET');
});

test('authentication errors do not trigger a transport retry', async t => {
  const link = new DeviceLink(); let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return new Response('{}', { status: 401 }); });
  await link.probe(device);
  assert.equal(calls, 1);
  assert.equal(link.latest.status, 'unauthorized');
});
