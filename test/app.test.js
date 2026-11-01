'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, intlPhone } = require('../src/app');

const H = { 'Content-Type': 'application/json', 'X-Mawid': '1' };
let server;
let base;
let dir;
let app;
let cookie = '';
// Monday 2 Nov 2026, 08:00 local
let clock = { date: '2026-11-02', minutes: 8 * 60 };

async function call(method, url, body, { auth = false, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...H, ...headers, ...(auth ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers };
}
const data = async () => (await call('GET', '/api/admin/data', undefined, { auth: true })).json;
const svc = async (name) => (await data()).services.find((s) => s.name === name);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mawid-test-'));
  app = createApp({ dataDir: dir, quiet: true, clock: () => clock });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fresh install needs the setup code', async () => {
  assert.equal((await call('GET', '/')).status, 302);
  const s = (await call('GET', '/api/state')).json;
  assert.equal(s.needsSetupCode, true);
  assert.deepEqual(s.businessTypes, ['barber', 'salon', 'clinic', 'coach', 'other']);
  assert.equal((await call('POST', '/api/setup', { password: 'supersecret' })).json.error, 'invalid_setup_code');
  const noHeader = await call('POST', '/api/setup', {}, { headers: { 'X-Mawid': '' } });
  assert.equal(noHeader.status, 403);
});

test('setup with a business type loads sample services and team', async () => {
  const r = await call('POST', '/api/setup', {
    setupCode: app.locals.setupCode, name: 'Fade Lab', type: 'barber', whatsapp: '+20 100 123 4567',
    currency: 'EGP', lang: 'en', password: 'supersecret', sample: true, timezone: 'Africa/Cairo',
  });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const d = await data();
  assert.equal(d.services.length, 5);
  assert.deepEqual(d.staff.map((m) => m.name), ['Omar', 'Karim']);
  assert.equal(d.settings.timezone, 'Africa/Cairo');
  assert.equal(d.settings.whatsapp, '+201001234567');
  // Kids cut is Karim only
  assert.deepEqual(d.services.find((s) => s.name === 'Kids cut').staffIds, [d.staff[1].id]);
});

test('booking page renders services in every language', async () => {
  const en = await call('GET', '/');
  assert.equal(en.status, 200);
  assert.match(en.text, /Fade Lab/);
  assert.match(en.text, /Haircut \+ beard/);
  assert.match(en.text, /data-service="/);
  const ar = await call('GET', '/?lang=ar');
  assert.match(ar.text, /dir="rtl"/);
  for (const l of ['es', 'pt', 'fr', 'tr', 'id', 'hi']) assert.equal((await call('GET', `/?lang=${l}`)).status, 200);
});

test('days and slots come from the availability engine', async () => {
  const cut = await svc('Haircut');
  const days = (await call('GET', `/api/days?service=${cut.id}`)).json.days;
  assert.equal(days.length, 31);
  assert.equal(days[0].date, '2026-11-02');
  assert.equal(days.find((d) => d.date === '2026-11-06').available, false, 'Friday is closed by default');
  const slots = (await call('GET', `/api/slots?service=${cut.id}&date=2026-11-02`)).json.slots;
  assert.equal(slots[0].start, 10 * 60, 'opens at 10:00');
  assert.equal(slots.at(-1).start, 19 * 60 + 30);
  assert.equal((await call('GET', '/api/slots?service=nope&date=2026-11-02')).status, 404);
});

test('booking a slot: confirmation, WhatsApp, manage link, calendar file', async () => {
  const cut = await svc('Haircut');
  const r = await call('POST', '/api/bookings', { serviceId: cut.id, date: '2026-11-03', start: 600, customer: { name: 'Sara Ali', phone: '01011112222', notes: 'Short please' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'confirmed');
  assert.equal(r.json.no, 1001);
  assert.match(r.json.whatsappUrl, /^https:\/\/wa\.me\/201001234567\?text=/);
  const msg = decodeURIComponent(r.json.whatsappUrl.split('text=')[1]);
  assert.match(msg, /New booking #1001/);
  assert.match(msg, /Haircut/);
  assert.match(msg, /Sara Ali/);
  assert.match(msg, /10:00/);

  const manage = await call('GET', `/b/${r.json.token}`);
  assert.equal(manage.status, 200);
  assert.match(manage.text, /Haircut/);
  assert.match(manage.text, /id="cancel"/);

  const ics = await call('GET', `/b/${r.json.token}.ics`);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.text, /DTSTART:20261103T080000Z/, '10:00 in Cairo (UTC+2) is 08:00 UTC');
  assert.match(ics.text, /BEGIN:VALARM/);
  assert.equal((await call('GET', '/b/nope')).status, 404);
});

test('no double booking: "anyone" spreads over the team, then the slot fills', async () => {
  const cut = await svc('Haircut');
  const book = (name) => call('POST', '/api/bookings', { serviceId: cut.id, date: '2026-11-03', start: 600, customer: { name, phone: '0100' } });
  const second = await book('B');
  assert.equal(second.status, 200);
  const third = await book('C');
  assert.equal(third.status, 409);
  assert.equal(third.json.error, 'slot_taken');
  const list = (await call('GET', '/api/admin/bookings?from=2026-11-03&to=2026-11-03', undefined, { auth: true })).json.bookings;
  assert.deepEqual(new Set(list.map((b) => b.staffName)), new Set(['Omar', 'Karim']));
  const slots = (await call('GET', `/api/slots?service=${cut.id}&date=2026-11-03`)).json.slots;
  assert.ok(!slots.some((s) => s.start === 600));
});

test('booking validation', async () => {
  const cut = await svc('Haircut');
  const bad = async (body) => (await call('POST', '/api/bookings', body)).json.error;
  assert.equal(await bad({ serviceId: 'x', date: '2026-11-03', start: 600, customer: { name: 'A', phone: '1' } }), 'invalid_service');
  assert.equal(await bad({ serviceId: cut.id, date: '2026-13-03', start: 600, customer: { name: 'A', phone: '1' } }), 'invalid_date');
  assert.equal(await bad({ serviceId: cut.id, date: '2026-11-03', start: 615, customer: { name: 'A', phone: '1' } }), 'slot_taken', 'not on the 30-minute grid');
  assert.equal(await bad({ serviceId: cut.id, date: '2026-11-03', start: 8 * 60, customer: { name: 'A', phone: '1' } }), 'slot_taken', 'before opening');
  assert.equal(await bad({ serviceId: cut.id, date: '2026-11-03', start: 660, customer: { name: 'A' } }), 'phone_required');
  assert.equal(await bad({ serviceId: cut.id, date: '2026-11-03', start: 660, customer: { phone: '1' } }), 'name_required');
});

test('customers can cancel until the cancellation window', async () => {
  const cut = await svc('Haircut');
  const later = await call('POST', '/api/bookings', { serviceId: cut.id, date: '2026-11-04', start: 600, customer: { name: 'D', phone: '1' } });
  assert.equal((await call('POST', `/api/bookings/${later.json.token}/cancel`)).status, 200);
  const page = await call('GET', `/b/${later.json.token}`);
  assert.match(page.text, /Cancelled/);
  assert.ok(!page.text.includes('id="cancel"'));

  const soon = await call('POST', '/api/bookings', { serviceId: cut.id, date: '2026-11-02', start: 10 * 60 + 30, customer: { name: 'E', phone: '1' } });
  assert.equal(soon.status, 200);
  const r = await call('POST', `/api/bookings/${soon.json.token}/cancel`);
  assert.equal(r.json.error, 'too_late', '10:30 is within 3 hours of 08:00');
});

test('owner: manual bookings, rescheduling, statuses, reminders', async () => {
  const cut = await svc('Haircut');
  const d = await data();
  // Manual booking ignores notice rules (now is 08:00, booking for 10:00 today)
  const m = await call('POST', '/api/admin/bookings', { serviceId: cut.id, staffId: d.staff[1].id, date: '2026-11-02', start: 600, customer: { name: 'Walk-in' } }, { auth: true });
  assert.equal(m.status, 200);
  assert.equal(m.json.source, 'admin');
  assert.equal(m.json.status, 'confirmed');
  // Overlap is still prevented
  const clash = await call('POST', '/api/admin/bookings', { serviceId: cut.id, staffId: d.staff[1].id, date: '2026-11-02', start: 600, customer: { name: 'X' } }, { auth: true });
  assert.equal(clash.status, 409);
  // Reschedule
  const moved = await call('PUT', `/api/admin/bookings/${m.json.id}`, { date: '2026-11-02', start: 630 }, { auth: true });
  assert.equal(moved.json.start, 630);
  assert.equal(moved.json.end, 660);
  // Status
  assert.equal((await call('PUT', `/api/admin/bookings/${m.json.id}`, { status: 'noshow' }, { auth: true })).json.status, 'noshow');
  assert.equal((await call('PUT', `/api/admin/bookings/${m.json.id}`, { status: 'bogus' }, { auth: true })).status, 400);
  // Reminder link: local number gets the business's country code
  const tomorrow = (await call('GET', '/api/admin/bookings?from=2026-11-03&to=2026-11-03', undefined, { auth: true })).json.bookings[0];
  const wa = await call('GET', `/api/admin/bookings/${tomorrow.id}/whatsapp?kind=reminder`, undefined, { auth: true });
  assert.match(wa.json.url, /^https:\/\/wa\.me\/201011112222\?text=/);
  assert.match(decodeURIComponent(wa.json.url), /reminder of your Haircut appointment at Fade Lab/);
});

test('phone normalisation', () => {
  assert.equal(intlPhone('01011112222', '+201001234567'), '201011112222');
  assert.equal(intlPhone('+44 7700 900123', '+20100'), '447700900123');
  assert.equal(intlPhone('0044 7700 900123', ''), '447700900123');
  assert.equal(intlPhone('4155550123', '14155550100'), '4155550123');
});

test('time off and staff changes affect availability', async () => {
  const d = await data();
  const cut = await svc('Haircut');
  for (const staffId of [d.staff[0].id, d.staff[1].id]) {
    await call('POST', '/api/admin/blocks', { date: '2026-11-05', staffId, from: '10:00', to: '14:00' }, { auth: true });
  }
  const slots = (await call('GET', `/api/slots?service=${cut.id}&date=2026-11-05`)).json.slots;
  assert.equal(slots[0].start, 14 * 60);
  const all = await call('POST', '/api/admin/blocks', { date: '2026-11-07', allDay: true }, { auth: true });
  assert.deepEqual((await call('GET', `/api/slots?service=${cut.id}&date=2026-11-07`)).json.slots, []);
  await call('DELETE', `/api/admin/blocks/${all.json.id}`, undefined, { auth: true });
  assert.ok((await call('GET', `/api/slots?service=${cut.id}&date=2026-11-07`)).json.slots.length > 0);
  assert.equal((await call('POST', '/api/admin/blocks', { date: '2026-11-07', from: '14:00', to: '10:00' }, { auth: true })).status, 400);

  // Removing Karim removes him from "Kids cut" too
  await call('DELETE', `/api/admin/staff/${d.staff[1].id}`, undefined, { auth: true });
  assert.deepEqual((await svc('Kids cut')).staffIds, []);
});

test('rules: auto-confirm off, closed, notice', async () => {
  const cut = await svc('Haircut');
  await call('PUT', '/api/admin/settings', { autoConfirm: false, minNotice: 240 }, { auth: true });
  const r = await call('POST', '/api/bookings', { serviceId: cut.id, date: '2026-11-09', start: 600, customer: { name: 'P', phone: '1' } });
  assert.equal(r.json.status, 'pending');
  assert.match(decodeURIComponent(r.json.whatsappUrl), /Waiting for your confirmation/);
  const today = (await call('GET', `/api/slots?service=${cut.id}&date=2026-11-02`)).json.slots;
  assert.ok(today.every((s) => s.start >= 12 * 60), '4h notice from 08:00');
  await call('PUT', '/api/admin/settings', { acceptingBookings: false }, { auth: true });
  assert.equal((await call('POST', '/api/bookings', { serviceId: cut.id, date: '2026-11-09', start: 660, customer: { name: 'P', phone: '1' } })).json.error, 'closed');
  await call('PUT', '/api/admin/settings', { acceptingBookings: true, autoConfirm: true, minNotice: 60 }, { auth: true });
});

test('settings are sanitized', async () => {
  const s = (await call('PUT', '/api/admin/settings', {
    color: 'red', theme: 'x', font: 'y', slotStep: 7, maxDays: 9999, timezone: 'Mars/Base', hours: [{ open: true }],
  }, { auth: true })).json.settings;
  assert.equal(s.color, '#7c3aed');
  assert.equal(s.theme, 'fresh');
  assert.equal(s.font, 'cairo');
  assert.equal(s.slotStep, 30);
  assert.equal(s.maxDays, 365);
  assert.equal(s.timezone, '');
  assert.equal(s.hours.length, 7, 'invalid week keeps the defaults');
  await call('PUT', '/api/admin/settings', { maxDays: 30, timezone: 'Africa/Cairo' }, { auth: true });
});

test('stats: today, reminders, revenue, no-shows', async () => {
  const st = (await call('GET', '/api/admin/stats', undefined, { auth: true })).json;
  assert.ok(st.todayList.length >= 1);
  assert.ok(st.remind.length >= 2);
  assert.equal(st.pending.length, 1);
  assert.equal(st.weekdays.length, 7);
  assert.ok('change' in st.revenue);
});

test('backup round-trip keeps services, team and bookings', async () => {
  const exp = (await call('GET', '/api/admin/export', undefined, { auth: true })).json;
  assert.equal(exp.app, 'mawid');
  const n = exp.bookings.length;
  await call('DELETE', `/api/admin/services/${exp.services[0].id}`, undefined, { auth: true });
  assert.equal((await call('POST', '/api/admin/import', exp, { auth: true })).status, 200);
  const d = await data();
  assert.equal(d.services.length, exp.services.length);
  assert.equal((await call('GET', '/api/admin/bookings', undefined, { auth: true })).json.bookings.length, n);
});

test('admin endpoints need a session; poster and QR work', async () => {
  assert.equal((await call('GET', '/api/admin/data')).status, 401);
  assert.equal((await call('GET', '/admin/poster')).status, 302);
  const poster = await call('GET', '/admin/poster', undefined, { auth: true });
  assert.match(poster.text, /<svg/);
  assert.match((await call('GET', '/api/admin/qr.svg', undefined, { auth: true })).text, /<svg/);
});

test('demo mode seeds a realistic, non-overlapping calendar', async () => {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mawid-demo-'));
  const demoApp = createApp({ dataDir: demoDir, demo: { password: 'demo1234', resetMinutes: 60, lang: 'en', type: 'salon' }, quiet: true });
  const store = demoApp.locals.store;
  assert.equal(store.settings.name, 'Studio Luna');
  assert.ok(store.bookings.length > 100);
  // No two active bookings for the same person overlap
  const active = store.bookings.filter((b) => ['pending', 'confirmed', 'completed', 'noshow'].includes(b.status));
  for (const a of active) {
    for (const b of active) {
      if (a === b || a.date !== b.date || a.staffId !== b.staffId) continue;
      assert.ok(a.end + a.buffer <= b.start || b.end + b.buffer <= a.start, `overlap ${a.id} ${b.id}`);
    }
  }
  fs.rmSync(demoDir, { recursive: true, force: true });
});

test('deposits: online bookings wait for the deposit, owner marks it received', async () => {
  await call('PUT', '/api/admin/settings', { depositPercent: 25, paymentInfo: 'InstaPay: fade@instapay', paymentLink: 'https://pay.example.com/fade', autoConfirm: true }, { auth: true });
  const combo = await svc('Haircut + beard'); // 28
  const r = await call('POST', '/api/bookings', { serviceId: combo.id, date: '2026-11-10', start: 600, customer: { name: 'Dep', phone: '1' } });
  assert.equal(r.json.status, 'pending', 'deposit overrides auto-confirm');
  assert.equal(r.json.deposit, 7);
  assert.equal(r.json.paymentInfo, 'InstaPay: fade@instapay');
  assert.match(decodeURIComponent(r.json.whatsappUrl), /Deposit: 7 EGP \(not paid yet\)/);
  const page = await call('GET', `/b/${r.json.token}`);
  assert.match(page.text, /deposit-card/);
  assert.match(page.text, /pay\.example\.com\/fade/);
  const bk = (await call('GET', '/api/admin/bookings?from=2026-11-10&to=2026-11-10', undefined, { auth: true })).json.bookings.find((x) => x.no === r.json.no);
  const paid = await call('PUT', `/api/admin/bookings/${bk.id}`, { depositPaid: true }, { auth: true });
  assert.equal(paid.json.depositPaid, true);
  assert.equal(paid.json.status, 'confirmed');
  assert.ok(!(await call('GET', `/b/${r.json.token}`)).text.includes('deposit-card'));
  // Owner bookings never ask for a deposit
  const own = await call('POST', '/api/admin/bookings', { serviceId: combo.id, date: '2026-11-10', start: 720, customer: { name: 'Own' } }, { auth: true });
  assert.equal(own.json.deposit, 0);
  assert.equal(own.json.status, 'confirmed');
  await call('PUT', '/api/admin/settings', { depositPercent: 0 }, { auth: true });
});
