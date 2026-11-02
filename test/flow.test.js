'use strict';

// End-to-end: deposit paid online → booking confirmed → WhatsApp API + email
// (with calendar invite); reminders the day before; backups; white-label.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const mailer = require('../src/mailer');

const H = { 'Content-Type': 'application/json', 'X-Mawid': '1' };
const realFetch = globalThis.fetch;
const outbound = [];
const mails = [];
let clock = { date: '2026-11-02', minutes: 8 * 60 };
let server, base, dir, cookie, store, app, combo;
let brand = { name: '', url: '', hideBranding: false };

const lastRef = () => Object.keys(store.db.payments.checkouts).pop();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) {
    outbound.push({ to: 'stripe', url: u, body: String(opts.body || '') });
    if (u.includes('/v1/checkout/sessions/')) return new Response(JSON.stringify({ id: 'cs_1', payment_status: 'paid', amount_total: 700, currency: 'egp', client_reference_id: lastRef(), payment_intent: 'pi_1' }), { status: 200 });
    return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
  }
  if (u.startsWith('https://graph.facebook.com/')) {
    outbound.push({ to: 'whatsapp', body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
  }
  return realFetch(url, opts);
};
const settle = () => new Promise((r) => setTimeout(r, 60));
async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await realFetch(base + url, { method, redirect: 'manual', headers: { ...H, ...(auth ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, url, body) => call(method, `/api/admin${url}`, body, { auth: true });

before(async () => {
  mailer.setTransportFactory(() => ({ sendMail: async (m) => (mails.push(m), { messageId: `m${mails.length}` }) }));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mawid-flow-'));
  app = createApp({ dataDir: dir, setupCode: 'TEST-CODE', quiet: true, clock: () => clock, branding: () => brand });
  store = app.locals.store;
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await call('POST', '/api/setup', { setupCode: 'TEST-CODE', name: 'Fade Lab', type: 'barber', whatsapp: '+20 100 123 4567', currency: 'EGP', lang: 'en', password: 'supersecret', sample: true, timezone: 'Africa/Cairo' });
  cookie = r.headers.get('set-cookie').split(';')[0];
  combo = (await admin('GET', '/data')).json.services.find((s) => s.name === 'Haircut + beard');
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('connections saved; secrets never returned or exported', async () => {
  assert.equal((await admin('PUT', '/payments', { provider: 'stripe', currency: 'egp', stripeSecret: 'sk_test_abcdefghijkl', stripeWebhookSecret: 'whsec_abcdefghijkl' })).status, 200);
  assert.equal((await admin('PUT', '/whatsapp', { token: 'EAAtoken123', phoneNumberId: '1234567890', language: 'en', templates: { confirmed: { enabled: true }, reminder: { enabled: true } } })).status, 200);
  assert.equal((await admin('PUT', '/email', { host: 'smtp.example.com', port: 587, user: 'u', pass: 'smtp-secret', from: 'Fade <hi@example.com>', ownerEmail: 'owner@example.com', alerts: true })).status, 200);
  await admin('PUT', '/settings', { depositPercent: 25, autoConfirm: true });
  const all = JSON.stringify([(await admin('GET', '/payments')).json, (await admin('GET', '/whatsapp')).json, (await admin('GET', '/email')).json, (await admin('GET', '/data')).json, (await admin('GET', '/export')).json]);
  for (const secret of ['sk_test_abcdefghijkl', 'whsec_abcdefghijkl', 'EAAtoken123', 'smtp-secret']) assert.ok(!all.includes(secret), secret);
});

test('deposit paid online confirms the booking and notifies the customer once', async () => {
  assert.equal((await call('POST', '/api/bookings', { serviceId: combo.id, date: '2026-11-03', start: 600, customer: { name: 'Sara Ali', phone: '01011112222', email: 'bad' } })).json.error, 'invalid_email');
  const r = await call('POST', '/api/bookings', { serviceId: combo.id, date: '2026-11-03', start: 600, customer: { name: 'Sara Ali', phone: '01011112222', email: 'Sara@Example.com' } });
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.deposit, 7);
  assert.equal(r.json.payOnline, true);
  await settle();
  assert.ok(mails.some((m) => m.to === 'sara@example.com' && /deposit/i.test(m.subject)));
  assert.ok(mails.some((m) => m.to === 'owner@example.com'));
  assert.match((await call('GET', `/b/${r.json.token}`)).text, /id="pay-online"/);

  const co = await call('POST', `/api/bookings/${r.json.token}/checkout`, {});
  assert.equal(co.json.url, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.match(outbound.find((x) => x.to === 'stripe').body, /unit_amount%5D=700/);

  outbound.length = 0;
  mails.length = 0;
  const ret = await call('GET', `/pay/return?ref=${lastRef()}&p=stripe&session_id=cs_1`);
  assert.match(ret.headers.get('location'), new RegExp(`/b/${r.json.token}\\?paid=1`));
  await settle();
  const b = store.byToken(r.json.token);
  assert.equal(b.depositPaid, true);
  assert.equal(b.status, 'confirmed');
  const msg = outbound.find((x) => x.to === 'whatsapp');
  assert.equal(msg.body.to, '201011112222');
  assert.equal(msg.body.template.name, 'mawid_confirmed');
  const conf = mails.find((m) => m.to === 'sara@example.com');
  assert.match(conf.subject, /Booking confirmed: Haircut \+ beard/);
  assert.equal(conf.attachments[0].contentType, 'text/calendar');
  assert.match((await call('GET', `/b/${r.json.token}?paid=1`)).text, /Deposit received/);

  // Webhook for the same payment: nothing new is sent.
  const n = outbound.length + mails.length;
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', client_reference_id: lastRef(), amount_total: 700, currency: 'egp', id: 'cs_1' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_abcdefghijkl').update(`${t}.${body}`).digest('hex');
  assert.equal((await call('POST', '/webhooks/stripe', body, { headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } })).status, 200);
  await settle();
  assert.equal(outbound.length + mails.length, n);
  assert.equal((await call('POST', `/api/bookings/${r.json.token}/checkout`, {})).status, 400);
});

test('owner confirming a booking sends the confirmation once', async () => {
  const r = await call('POST', '/api/bookings', { serviceId: combo.id, date: '2026-11-03', start: 720, customer: { name: 'Omar', phone: '01005556666' } });
  const id = store.byToken(r.json.token).id;
  outbound.length = 0;
  await admin('PUT', `/bookings/${id}`, { depositPaid: true });
  await admin('PUT', `/bookings/${id}`, { status: 'confirmed' });
  await settle();
  assert.equal(outbound.filter((x) => x.to === 'whatsapp').length, 1);
});

test('reminders: once, the day before, after 10:00', async () => {
  clock = { date: '2026-11-02', minutes: 9 * 60 };
  assert.equal(app.locals.runReminders(), 0);
  clock = { date: '2026-11-02', minutes: 11 * 60 };
  outbound.length = 0;
  mails.length = 0;
  assert.equal(app.locals.runReminders(), 2);
  assert.equal(app.locals.runReminders(), 0);
  await settle();
  assert.equal(outbound.filter((x) => x.body.template.name === 'mawid_reminder').length, 2);
  assert.ok(mails.some((m) => m.to === 'sara@example.com' && /^Tomorrow/.test(m.subject)));
});

test('backups and white-label', async () => {
  const r = await admin('POST', '/backups/now');
  assert.equal(r.status, 200);
  const file = await admin('GET', `/backups/${r.json.date}`);
  assert.equal(file.json.app, 'mawid');
  assert.ok(!file.text.includes('smtp-secret'));
  assert.match((await call('GET', '/')).text, /github.com\/mashraf1997\/mawid/);
  brand = { name: 'Pixel Agency', url: 'https://pixel.example', hideBranding: false };
  assert.match((await call('GET', '/')).text, /Pixel Agency/);
  assert.equal((await call('GET', '/api/state')).json.brand.name, 'Pixel Agency');
  brand = { name: '', url: '', hideBranding: true };
  assert.ok(!(await call('GET', '/')).text.includes('class="powered"'));
});
