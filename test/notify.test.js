'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const notify = require('../src/notify');

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const H = { 'Content-Type': 'application/json', 'X-Mawid': '1' };
const sent = [];
const realFetch = globalThis.fetch;
let server;
let base;
let dir;
let cookie;

// Fake Telegram API; everything else goes to the real network stack.
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.telegram.org/')) return realFetch(url, opts);
  const method = String(url).split('/').pop();
  const body = JSON.parse(opts.body || '{}');
  if (!String(url).includes(TOKEN)) return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 });
  if (method === 'getUpdates') return new Response(JSON.stringify({ ok: true, result: [{ message: { chat: { id: 4242, first_name: 'Owner' } } }] }));
  if (body.parse_mode && /_/.test(body.text)) return new Response(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }));
  sent.push(body);
  return new Response(JSON.stringify({ ok: true }));
};

const call = async (method, url, body, auth = true) => {
  const res = await realFetch(base + url, { method, headers: { ...H, ...(auth ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const waitFor = async (fn) => {
  for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mawid-notify-'));
  const app = createApp({ dataDir: dir, setupCode: 'CODE-CODE', quiet: true });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await realFetch(`${base}/api/setup`, { method: 'POST', headers: H, body: JSON.stringify({ setupCode: 'CODE-CODE', name: 'Shop_One', type: 'barber', password: 'supersecret', lang: 'en', sample: true }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('telegram settings: validation, detection, token never returned', async () => {
  assert.equal((await call('PUT', '/api/admin/notify', { telegramToken: 'nope' })).json.error, 'invalid_token');
  const saved = await call('PUT', '/api/admin/notify', { telegramToken: TOKEN });
  assert.equal(saved.json.hasToken, true);
  assert.equal(saved.json.tokenHint, '…AAAA');
  assert.equal(saved.json.connected, false);
  const det = await call('POST', '/api/admin/notify/detect', {});
  assert.deepEqual(det.json.chats, [{ id: '4242', name: 'Owner' }]);
  const ok = await call('PUT', '/api/admin/notify', { telegramChat: '4242' });
  assert.equal(ok.json.connected, true);
  const view = await call('GET', '/api/admin/notify');
  assert.ok(!JSON.stringify(view.json).includes(TOKEN), 'token is never sent back');
  assert.equal((await call('GET', '/api/admin/notify', undefined, false)).status, 401);
});

test('test message, new bookings and customer cancellations reach Telegram', async () => {
  assert.equal((await call('POST', '/api/admin/notify/test', { text: 'hello' })).status, 200);
  assert.match(sent.at(-1).text, /hello/);
  const data = (await call('GET', '/api/admin/data')).json;
  const cut = data.services.find((s) => s.name === 'Haircut');
  const date = data.now.date;
  const tomorrow = new Date(Date.parse(`${date}T00:00:00Z`) + 3 * 864e5).toISOString().slice(0, 10);
  const slots = (await call('GET', `/api/slots?service=${cut.id}&date=${tomorrow}`, undefined, false)).json.slots;
  let before = sent.length;
  const b = await call('POST', '/api/bookings', { serviceId: cut.id, date: tomorrow, start: slots[0].start, customer: { name: 'Sara_Ali', phone: '1' } }, false);
  assert.equal(b.status, 200);
  await waitFor(() => sent.length > before);
  assert.match(sent.at(-1).text, /New booking #1001/);
  assert.match(sent.at(-1).text, /admin#home/);
  assert.equal(sent.at(-1).parse_mode, undefined, 'underscore in the name → resent as plain text');
  before = sent.length;
  assert.equal((await call('POST', `/api/bookings/${b.json.token}/cancel`, {}, false)).status, 200);
  await waitFor(() => sent.length > before);
  assert.match(sent.at(-1).text, /Cancelled by the customer #1001/);
});

test('backups never contain the bot token', async () => {
  const res = await realFetch(`${base}/api/admin/export`, { headers: { Cookie: cookie } });
  assert.ok(!(await res.text()).includes(TOKEN));
});

test('disconnect clears everything; bad tokens are reported, not thrown', async () => {
  const r = await call('PUT', '/api/admin/notify', { clear: true });
  assert.equal(r.json.hasToken, false);
  assert.equal((await call('POST', '/api/admin/notify/test', {})).status, 400);
  const bad = await notify.sendTelegram({ telegramToken: '999999999:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', telegramChat: '1234' }, 'x');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unauthorized/);
});
