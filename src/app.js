'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');

const { Store, defaultSettings, localDate } = require('./store');
const auth = require('./auth');
const { LANGS, LANGUAGES, adminStrings } = require('./i18n');
const { cleanTheme, cleanFont, appearanceOptions } = require('./theme');
const { validTimezone } = require('./schedule');
const A = require('./availability');
const B = require('./bookings');
const { loadSample, BUSINESS_TYPES } = require('./sample');
const { resetDemo } = require('./demo');
const notify = require('./notify');
const payments = require('./payments');
const wa = require('./whatsapp');
const mailer = require('./mailer');
const push = require('./push');
const backup = require('./backup');
const { strings } = require('./i18n');
const { renderBookingPage, renderManagePage, renderPoster, renderManifest } = require('./views');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- sanitizers ----------
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n * 100) / 100) : 0;
};
const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const bool = (v) => v === true || v === 'true' || v === 1 || v === 'on';
const imageUrl = (v) => {
  const s = str(v, 500);
  return /^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(s) ? s : '';
};

function cleanWeek(input, fallback) {
  if (!Array.isArray(input) || input.length !== 7) return fallback;
  return input.map((d) => ({
    open: bool(d && d.open),
    from: TIME_RE.test(d && d.from) ? d.from : '09:00',
    to: TIME_RE.test(d && d.to) ? d.to : '17:00',
  }));
}

const SETTINGS_SCHEMA = {
  name: (v) => str(v, 80) || 'My Studio',
  tagline: (v) => str(v, 140),
  about: (v) => str(v, 1000),
  logo: imageUrl,
  cover: imageUrl,
  whatsapp: (v) => str(v, 30).replace(/[^\d+]/g, ''),
  phone: (v) => str(v, 30),
  address: (v) => str(v, 200),
  mapUrl: (v) => (/^https?:\/\//i.test(str(v, 500)) ? str(v, 500) : ''),
  instagram: (v) => str(v, 200),
  facebook: (v) => str(v, 200),
  tiktok: (v) => str(v, 200),
  currency: (v) => str(v, 12),
  lang: (v) => (LANGS.includes(v) ? v : 'en'),
  color: (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : defaultSettings().color),
  theme: cleanTheme,
  font: cleanFont,
  timezone: validTimezone,
  hours: (v) => cleanWeek(v, defaultSettings().hours),
  acceptingBookings: bool,
  autoConfirm: bool,
  slotStep: (v) => ([10, 15, 20, 30, 45, 60].includes(Number(v)) ? Number(v) : 30),
  minNotice: (v) => int(v, 0, 7 * 1440, 60),
  maxDays: (v) => int(v, 1, 365, 30),
  cancelHours: (v) => int(v, 0, 168, 3),
  policy: (v) => str(v, 600),
  depositPercent: (v) => int(v, 0, 100, 0),
  paymentInfo: (v) => str(v, 300),
  paymentLink: (v) => (/^https?:\/\//i.test(str(v, 500)) ? str(v, 500) : ''),
};

function cleanSettings(input) {
  const out = {};
  for (const [key, fn] of Object.entries(SETTINGS_SCHEMA)) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = fn(input[key]);
  }
  return out;
}

function cleanService(input, store) {
  const staffIds = Array.isArray(input.staffIds) ? input.staffIds.map(String).filter((id) => store.get('staff', id)) : [];
  return {
    name: str(input.name, 100),
    description: str(input.description, 400),
    emoji: str(input.emoji, 8),
    duration: int(input.duration, 5, 12 * 60, 30),
    buffer: int(input.buffer, 0, 240, 0),
    price: num(input.price),
    active: input.active === undefined ? true : bool(input.active),
    staffIds,
  };
}

function cleanMember(input) {
  return {
    name: str(input.name, 60),
    title: str(input.title, 60),
    photo: imageUrl(input.photo),
    active: input.active === undefined ? true : bool(input.active),
    hours: input.hours ? cleanWeek(input.hours, null) : null,
  };
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateSetupCode() {
  const chars = [...crypto.randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Turns a customer's phone into an international number for wa.me.
 * Local numbers ("0101…") borrow the country code from the business's WhatsApp number.
 */
function intlPhone(phone, shopWhatsapp) {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  const shop = String(shopWhatsapp || '').replace(/\D/g, '');
  if (digits.startsWith('0') && shop) {
    const national = digits.slice(1);
    const cc = shop.slice(0, shop.length - national.length);
    if (cc.length >= 1 && cc.length <= 3) digits = cc + national;
  }
  return digits;
}

function createApp({ dataDir, setupCode, demo = null, quiet = false, clock = null, branding = null }) {
  const store = new Store(dataDir);
  const app = express();
  const now = () => (clock ? clock() : A.nowIn(store.settings.timezone));
  const nowMs = () => (clock && clock().ms) || Date.now();
  const limit = (windowMs, max) => auth.rateLimiter({ windowMs, max });
  const loginLimited = limit(15 * 60 * 1000, 10);
  const setupLimited = limit(15 * 60 * 1000, 10);
  const bookLimited = limit(10 * 60 * 1000, 15);

  if (demo) {
    resetDemo(store, demo);
    setInterval(() => resetDemo(store, demo), demo.resetMinutes * 60 * 1000).unref();
  } else if (!store.db.setupDone) {
    if (setupCode) store.db.setupCode = setupCode;
    else if (!store.db.setupCode) store.db.setupCode = generateSetupCode();
    store.save();
    if (!quiet) {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Setup code: ${store.db.setupCode.padEnd(32)}│`);
      console.log('  │  Open /admin in your browser and enter it    │');
      console.log('  │  to set up your booking page.                │');
      console.log('  └──────────────────────────────────────────────┘');
      console.log('');
    }
  }

  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const baseUrl = (req) => `${req.protocol}://${req.get('host')}/`;
  const manageUrl = (req, b) => `${baseUrl(req)}b/${b.token}`;

  // ---------- integrations ----------
  // Background jobs (webhooks, reminders) link to the last public address.
  const rememberBase = (req) => {
    const b = baseUrl(req);
    if (store.db.publicUrl !== b && !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(b)) {
      store.db.publicUrl = b;
      store.save();
    }
  };
  const publicBase = () => store.db.publicUrl || `http://localhost:${process.env.PORT || 3000}/`;
  const snapshot = () => {
    const { settings, services, staff, blocks } = store.db;
    return { app: 'mawid', version: 1, exportedAt: new Date().toISOString(), settings, services, staff, blocks, bookings: store.bookings };
  };
  const brand = () => ({ name: store.settings.name, color: store.settings.color });
  const tx = () => strings(store.settings.lang);
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const fill = (tpl, v) => Object.entries(v).reduce((o, [k, x]) => o.split(`{${k}}`).join(x), tpl);
  const whenOf = (b) => `${B.dateLabel(b.date, store.settings.lang)} · ${B.timeLabel(b.start, store.settings.lang)}`;
  const WA_KINDS = [
    { key: 'confirmed', defaultName: 'mawid_confirmed', params: ['name', 'service', 'when', 'link'], sample: { en: 'Hi {{1}}! Your booking for {{2}} on {{3}} is confirmed ✅ Details or changes: {{4}}', ar: 'أهلًا يا {{1}}! حجزك لـ {{2}} يوم {{3}} اتأكد ✅ التفاصيل أو التعديل: {{4}}' } },
    { key: 'reminder', defaultName: 'mawid_reminder', params: ['name', 'service', 'when', 'link'], sample: { en: 'Hi {{1}}, a reminder of your {{2}} tomorrow: {{3}}. Need to change it? {{4}}', ar: 'أهلًا يا {{1}}، بنفكرك بميعاد {{2}} بكرة: {{3}}. عايز تغيّر؟ {{4}}' } },
  ];
  const venue = () => [store.settings.address].filter(Boolean).join('');

  /** The booking is confirmed: tell the customer once (WhatsApp API + email). */
  function sendConfirmation(b, base) {
    if (!b || b.confirmSent || b.status !== 'confirmed') return;
    const url = `${base}b/${b.token}`;
    const t = tx();
    wa.sendInBackground(store, 'confirmed', intlPhone(b.customer.phone, store.settings.whatsapp), [firstName(b.customer.name), b.serviceName, whenOf(b), url]);
    if (b.customer.email) {
      const title = fill(t.mailConfirmedTitle, { service: b.serviceName });
      const { html, text } = mailer.render({ brand: brand(), dir: t.dir, title, body: fill(t.mailConfirmedBody, { name: firstName(b.customer.name), service: b.serviceName, when: whenOf(b), with: b.staffName || '-', place: venue() || store.settings.name }), button: { label: t.mailManage, url }, footer: store.settings.address || '' });
      mailer.sendInBackground(store, { to: b.customer.email, subject: title, html, text, attachments: [{ filename: `booking-${b.no}.ics`, content: B.ics(b, store.settings, url), contentType: 'text/calendar' }] });
    }
    store.updateBooking(b.id, { confirmSent: true });
  }

  function askForDeposit(b, base) {
    if (!b.deposit || !b.customer.email) return;
    const t = tx();
    const s = store.settings;
    const title = fill(t.mailDepositTitle, { service: b.serviceName });
    const { html, text } = mailer.render({ brand: brand(), dir: t.dir, title, body: [fill(t.mailDepositBody, { name: firstName(b.customer.name), amount: B.formatMoney(b.deposit, s.currency), service: b.serviceName, when: whenOf(b) }), s.paymentInfo || ''].filter(Boolean).join('\n\n'), button: { label: t.mailPayDeposit, url: `${base}b/${b.token}` } });
    mailer.sendInBackground(store, { to: b.customer.email, subject: title, html, text });
  }

  // Online payments (deposits) land here once, from the return page or a webhook.
  async function onPaid(kind, id, info) {
    if (kind !== 'deposit') return;
    const b = store.getBooking(id);
    if (!b) return;
    const patch = { depositPaid: true, depositVia: info.provider };
    if (b.status === 'pending') patch.status = 'confirmed';
    store.updateBooking(b.id, patch);
    sendConfirmation(store.getBooking(b.id), publicBase());
    notify.alertOwner(store, `💳 *${tx().msgDepositPaidOnline} #${b.no}*\n${b.serviceName} · ${whenOf(b)}\n${B.formatMoney(info.amount, store.settings.currency)} · ${b.customer.name}`, { url: `${publicBase()}admin#home`, path: '/admin#home' });
  }

  /** Day before (after 10:00): remind confirmed customers who weren't reminded yet. */
  function sendReminders() {
    const n = now();
    if (n.minutes < 10 * 60) return 0;
    const tomorrow = A.addDays(n.date, 1);
    const waC = wa.cfgOf(store);
    const waOn = wa.ready(waC) && (waC.templates.reminder || {}).enabled;
    const mailOn = mailer.ready(mailer.cfgOf(store));
    if (!waOn && !mailOn) return 0;
    const t = tx();
    let sent = 0;
    for (const b of store.bookings.filter((x) => x.date === tomorrow && x.status === 'confirmed' && !x.reminded)) {
      const url = `${publicBase()}b/${b.token}`;
      if (waOn) wa.sendInBackground(store, 'reminder', intlPhone(b.customer.phone, store.settings.whatsapp), [firstName(b.customer.name), b.serviceName, whenOf(b), url]);
      if (mailOn && b.customer.email) {
        const title = fill(t.mailReminderTitle, { service: b.serviceName });
        const { html, text } = mailer.render({ brand: brand(), dir: t.dir, title, body: fill(t.mailReminderBody, { name: firstName(b.customer.name), service: b.serviceName, when: whenOf(b), place: venue() || store.settings.name }), button: { label: t.mailManage, url } });
        mailer.sendInBackground(store, { to: b.customer.email, subject: title, html, text });
      }
      b.reminded = true;
      sent++;
    }
    if (sent) store.saveBookings();
    return sent;
  }
  const viewSettings = () => (branding ? { ...store.settings, _brand: branding() } : store.settings);
  const pickLang = (req) => (LANGS.includes(req.query.lang) ? req.query.lang : store.settings.lang);
  const requireAuth = (req, res, next) => (auth.isAuthenticated(req, store.db) ? next() : res.status(401).json({ error: 'unauthorized' }));
  const notInDemo = (req, res, next) => (demo ? res.status(403).json({ error: 'demo' }) : next());
  const requireHeader = (req, res, next) => (req.method === 'GET' || req.get('x-mawid') === '1' ? next() : res.status(403).json({ error: 'forbidden' }));
  const engineArgs = () => ({ settings: store.settings, staff: store.db.staff, bookings: store.bookings, blocks: store.db.blocks, services: store.db.services });

  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: false }));
  app.use('/uploads', express.static(store.uploadsDir, { maxAge: '30d', immutable: true }));
  payments.mountPublic(app, store, express, { onPaid });
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---------- public pages ----------
  app.get('/', (req, res) => {
    if (!store.db.setupDone) return res.redirect('/admin');
    const preview = req.query.preview === '1';
    const today = localDate();
    if (!preview && !BOT_RE.test(req.get('user-agent') || '') && !(req.headers.cookie || '').includes(`mw_v=${today}`)) {
      store.recordVisit(today);
      res.append('Set-Cookie', `mw_v=${today}; Path=/; Max-Age=86400; SameSite=Lax`);
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(
      renderBookingPage({
        settings: viewSettings(),
        services: store.sorted('services'),
        staff: store.sorted('staff'),
        lang: pickLang(req),
        baseUrl: baseUrl(req),
        now: now(),
        demo: !!demo,
        preview,
        languages: LANGUAGES,
        preselect: str(req.query.service, 20),
      })
    );
  });

  app.get('/b/:token.ics', (req, res) => {
    const b = store.byToken(req.params.token);
    if (!b) return res.status(404).type('text').send('Not found');
    res.setHeader('Content-Disposition', `attachment; filename="booking-${b.no}.ics"`);
    res.type('text/calendar; charset=utf-8').send(B.ics(b, store.settings, manageUrl(req, b)));
  });

  app.get('/b/:token', (req, res) => {
    const b = store.byToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    res.status(b ? 200 : 404).type('html').send(
      renderManagePage({
        settings: viewSettings(),
        booking: b,
        payOnline: !!b && !demo && payments.ready(payments.cfgOf(store)),
        payPending: req.query.pay === 'pending',
        justPaid: req.query.paid === '1',
        lang: pickLang(req),
        baseUrl: baseUrl(req),
        now: now(),
        canCancel: !!b && B.canCustomerCancel(b, store.settings, now()),
      })
    );
  });

  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(renderManifest(store.settings))));
  app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

  // ---------- public API ----------
  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  api.use(requireHeader);

  api.get('/i18n/:lang', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ strings: adminStrings(req.params.lang), languages: LANGUAGES });
  });

  api.get('/state', (req, res) => {
    res.json({
      setupDone: store.db.setupDone,
      authed: auth.isAuthenticated(req, store.db),
      lang: store.settings.lang,
      needsSetupCode: !store.db.setupDone,
      demo: demo ? { password: demo.password, resetMinutes: demo.resetMinutes } : null,
      languages: LANGUAGES,
      businessTypes: BUSINESS_TYPES,
      brand: branding ? branding() : null,
    });
  });

  api.get('/days', (req, res) => {
    const service = store.get('services', str(req.query.service, 20));
    if (!service || service.active === false) return res.status(404).json({ error: 'invalid_service' });
    const count = Math.min(60, Math.max(1, Number(store.settings.maxDays) || 30) + 1);
    res.json({ days: A.openDays({ ...engineArgs(), service, now: now(), staffId: str(req.query.staff, 20) }, count) });
  });

  api.get('/slots', (req, res) => {
    const service = store.get('services', str(req.query.service, 20));
    if (!service || service.active === false) return res.status(404).json({ error: 'invalid_service' });
    const date = str(req.query.date, 10);
    const slots = A.slotsFor({ ...engineArgs(), service, now: now(), date, staffId: str(req.query.staff, 20) });
    res.json({ date, slots: slots.map((s) => ({ start: s.start })) });
  });

  api.post('/bookings', (req, res) => {
    if (bookLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const result = B.buildBooking(req.body || {}, store, { now: now() });
    if (result.error) return res.status(result.error === 'slot_taken' ? 409 : 400).json(result);
    const b = store.addBooking(result.booking);
    const text = B.bookingMessage(b, store.settings);
    rememberBase(req);
    notify.alertOwner(store, text, { url: `${baseUrl(req)}admin#home`, path: '/admin#home' });
    if (b.status === 'confirmed') sendConfirmation(b, baseUrl(req));
    else askForDeposit(b, baseUrl(req));
    res.json({
      payOnline: !!b.deposit && !demo && payments.ready(payments.cfgOf(store)),
      no: b.no,
      token: b.token,
      status: b.status,
      deposit: b.deposit,
      paymentInfo: b.deposit ? store.settings.paymentInfo : '',
      paymentLink: b.deposit ? store.settings.paymentLink : '',
      manageUrl: manageUrl(req, b),
      icsUrl: `/b/${b.token}.ics`,
      whatsappUrl: B.whatsappUrl(store.settings.whatsapp, text),
      staffName: b.staffName,
    });
  });

  // Pay the deposit online (Stripe / Paymob).
  api.post('/bookings/:token/checkout', async (req, res) => {
    if (bookLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = store.byToken(req.params.token);
    if (!b) return res.status(404).json({ error: 'not_found' });
    if (!b.deposit || b.depositPaid || !A.ACTIVE.includes(b.status)) return res.status(400).json({ error: 'not_payable' });
    try {
      const r = await payments.createCheckout(store, baseUrl(req), { kind: 'deposit', id: b.id, amount: b.deposit, title: `${b.serviceName} · #${b.no}`, customer: b.customer, returnTo: `/b/${b.token}` });
      res.json({ url: r.url });
    } catch (err) {
      res.status(400).json({ error: err.code || 'provider_error' });
    }
  });

  api.post('/bookings/:token/cancel', (req, res) => {
    const b = store.byToken(req.params.token);
    if (!b) return res.status(404).json({ error: 'not_found' });
    if (!B.canCustomerCancel(b, store.settings, now())) return res.status(400).json({ error: 'too_late' });
    store.updateBooking(b.id, { status: 'cancelled', cancelledBy: 'customer' });
    notify.alertOwner(store, B.cancelMessage(b, store.settings), { url: `${baseUrl(req)}admin#home`, path: '/admin#home' });
    res.json({ ok: true });
  });

  api.post('/setup', notInDemo, (req, res) => {
    if (store.db.setupDone) return res.status(409).json({ error: 'already_setup' });
    if (setupLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    const b = req.body || {};
    const given = normCode(b.setupCode);
    const expected = normCode(store.db.setupCode);
    if (!given || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
      return res.status(403).json({ error: 'invalid_setup_code' });
    }
    if (typeof b.password !== 'string' || b.password.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.updateSettings(cleanSettings({ name: b.name, whatsapp: b.whatsapp, currency: b.currency, lang: b.lang, timezone: b.timezone }));
    store.db.auth = auth.hashPassword(b.password);
    store.db.setupDone = true;
    delete store.db.setupCode;
    store.save();
    if (bool(b.sample)) loadSample(store, BUSINESS_TYPES.includes(b.type) ? b.type : 'other', store.settings.lang);
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  api.post('/login', (req, res) => {
    if (loginLimited(req.ip)) return res.status(429).json({ error: 'rate_limited' });
    if (!auth.verifyPassword(req.body && req.body.password, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie());
    res.json({ ok: true });
  });

  // ---------- admin API ----------
  const admin = express.Router();
  admin.use(requireAuth);
  notify.mountRoutes(admin, store, { guard: notInDemo, appName: 'Mawid' });
  payments.mountAdmin(admin, store, { guard: notInDemo, baseUrl });
  wa.mountAdmin(admin, store, { guard: notInDemo, kinds: WA_KINDS });
  mailer.mountAdmin(admin, store, { guard: notInDemo, appName: 'Mawid' });
  push.mountAdmin(admin, store, { appName: 'Mawid' });
  backup.mountAdmin(admin, store, { snapshot, guard: notInDemo, appName: 'Mawid' });
  admin.use((req, res, next) => {
    rememberBase(req);
    next();
  });

  admin.get('/data', (req, res) => {
    res.json({
      settings: store.settings,
      services: store.sorted('services'),
      staff: store.sorted('staff'),
      blocks: [...store.db.blocks].sort((a, b) => a.date.localeCompare(b.date) || (a.from || 0) - (b.from || 0)),
      baseUrl: baseUrl(req),
      now: now(),
      demo: !!demo,
      appearance: appearanceOptions(store.settings.lang),
    });
  });

  admin.put('/settings', (req, res) => {
    const before = { logo: store.settings.logo, cover: store.settings.cover };
    const settings = store.updateSettings(cleanSettings(req.body));
    store.removeUploadIfUnused(before.logo);
    store.removeUploadIfUnused(before.cover);
    res.json({ settings });
  });

  admin.put('/password', notInDemo, (req, res) => {
    const { current, next } = req.body || {};
    if (!auth.verifyPassword(current, store.db.auth)) return res.status(401).json({ error: 'wrong_password' });
    if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'weak_password' });
    store.db.auth = auth.hashPassword(next);
    store.save();
    res.setHeader('Set-Cookie', auth.createSessionCookie(store.db, req.secure));
    res.json({ ok: true });
  });

  // services & staff share the same CRUD shape
  for (const [coll, clean] of [['services', (b) => cleanService(b, store)], ['staff', cleanMember]]) {
    admin.post(`/${coll}`, (req, res) => {
      const data = clean(req.body || {});
      if (!data.name) return res.status(400).json({ error: 'name_required' });
      res.json(store.add(coll, data));
    });
    admin.put(`/${coll}/:id`, (req, res) => {
      const existing = store.get(coll, req.params.id);
      if (!existing) return res.status(404).json({ error: 'not_found' });
      const data = clean({ ...existing, ...req.body });
      if (!data.name) return res.status(400).json({ error: 'name_required' });
      const oldPhoto = existing.photo;
      const item = store.update(coll, existing.id, data);
      if (oldPhoto && oldPhoto !== item.photo) store.removeUploadIfUnused(oldPhoto);
      res.json(item);
    });
    admin.delete(`/${coll}/:id`, (req, res) => {
      const item = store.remove(coll, req.params.id);
      if (!item) return res.status(404).json({ error: 'not_found' });
      store.removeUploadIfUnused(item.photo);
      res.json({ ok: true });
    });
  }

  admin.post('/reorder', (req, res) => {
    const { collection, ids } = req.body || {};
    if (!['services', 'staff'].includes(collection) || !Array.isArray(ids)) return res.status(400).json({ error: 'invalid' });
    store.reorder(collection, ids.map(String));
    res.json({ ok: true });
  });

  admin.post('/blocks', (req, res) => {
    const b = req.body || {};
    const date = str(b.date, 10);
    if (!A.isDate(date)) return res.status(400).json({ error: 'invalid_date' });
    const staffId = str(b.staffId, 20);
    if (staffId && !store.get('staff', staffId)) return res.status(400).json({ error: 'invalid_staff' });
    const allDay = bool(b.allDay);
    const from = allDay ? 0 : A.toMin(TIME_RE.test(b.from) ? b.from : '00:00');
    const to = allDay ? 1440 : A.toMin(TIME_RE.test(b.to) ? b.to : '00:00') || 1440;
    if (!allDay && to <= from) return res.status(400).json({ error: 'invalid_time' });
    const block = { id: crypto.randomBytes(5).toString('base64url'), date, staffId, allDay, from, to, note: str(b.note, 100) };
    store.db.blocks.push(block);
    store.save();
    res.json(block);
  });

  admin.delete('/blocks/:id', (req, res) => {
    const before = store.db.blocks.length;
    store.db.blocks = store.db.blocks.filter((b) => b.id !== req.params.id);
    if (before === store.db.blocks.length) return res.status(404).json({ error: 'not_found' });
    store.save();
    res.json({ ok: true });
  });

  admin.get('/bookings', (req, res) => {
    const from = A.isDate(req.query.from) ? req.query.from : '';
    const to = A.isDate(req.query.to) ? req.query.to : '';
    const status = B.STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = str(req.query.q, 60).toLowerCase();
    const list = store.bookings
      .filter((b) => (!from || b.date >= from) && (!to || b.date <= to) && (!status || b.status === status))
      .filter((b) => !q || `${b.customer.name} ${b.customer.phone} ${b.no}`.toLowerCase().includes(q))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const newest = req.query.order === 'desc';
    res.json({ bookings: (newest ? list.reverse() : list).slice(0, 500) });
  });

  admin.get('/slots', (req, res) => {
    const service = store.get('services', str(req.query.service, 20));
    if (!service) return res.status(404).json({ error: 'invalid_service' });
    const slots = A.slotsFor({
      ...engineArgs(),
      service,
      now: now(),
      date: str(req.query.date, 10),
      staffId: str(req.query.staff, 20),
      ignoreRules: true,
      excludeBookingId: str(req.query.exclude, 20),
    });
    res.json({ slots });
  });

  admin.post('/bookings', (req, res) => {
    const result = B.buildBooking(req.body || {}, store, { now: now(), admin: true });
    if (result.error) return res.status(result.error === 'slot_taken' ? 409 : 400).json(result);
    const b = store.addBooking(result.booking);
    sendConfirmation(b, baseUrl(req));
    res.json(store.getBooking(b.id));
  });

  admin.put('/bookings/:id', (req, res) => {
    const b = store.getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'not_found' });
    const body = req.body || {};
    if (body.date !== undefined || body.start !== undefined) {
      // Reschedule: re-check availability, ignoring this booking itself.
      const result = B.buildBooking(
        { serviceId: b.serviceId, staffId: body.staffId !== undefined ? body.staffId : b.staffId, date: body.date || b.date, start: body.start !== undefined ? body.start : b.start, customer: b.customer, excludeBookingId: b.id },
        store,
        { now: now(), admin: true }
      );
      if (result.error) return res.status(409).json(result);
      const { date, start, end, staffId, staffName } = result.booking;
      return res.json(store.updateBooking(b.id, { date, start, end, staffId, staffName, reminded: false }));
    }
    const patch = {};
    if (body.status !== undefined) {
      if (!B.STATUSES.includes(body.status)) return res.status(400).json({ error: 'invalid_status' });
      patch.status = body.status;
    }
    if (body.reminded !== undefined) patch.reminded = bool(body.reminded);
    if (body.depositPaid !== undefined) {
      patch.depositPaid = bool(body.depositPaid);
      if (patch.depositPaid && b.status === 'pending' && patch.status === undefined) patch.status = 'confirmed';
    }
    if (body.notes !== undefined) patch.customer = { ...b.customer, notes: str(body.notes, 500) };
    store.updateBooking(b.id, patch);
    sendConfirmation(store.getBooking(b.id), baseUrl(req));
    res.json(store.getBooking(b.id));
  });

  admin.get('/bookings/:id/whatsapp', (req, res) => {
    const b = store.getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'not_found' });
    const phone = intlPhone(b.customer.phone, store.settings.whatsapp);
    const text = req.query.kind === 'reminder' ? B.reminderMessage(b, store.settings, manageUrl(req, b)) : '';
    res.json({ url: text ? B.whatsappUrl(phone, text) : `https://wa.me/${phone}` });
  });

  admin.get('/stats', (req, res) => res.json(computeStats(store, now())));

  admin.post('/upload', (req, res) => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec((req.body && req.body.dataUrl) || '');
    if (!m) return res.status(400).json({ error: 'invalid_image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'too_large' });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(store.uploadsDir, name), buf);
    res.json({ url: `/uploads/${name}` });
  });

  admin.get('/qr.svg', async (req, res) => {
    const svg = await QRCode.toString(str(req.query.text, 500) || baseUrl(req), { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  });

  admin.get('/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="mawid-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(snapshot());
  });

  admin.post('/import', notInDemo, (req, res) => {
    const b = req.body || {};
    if (b.app !== 'mawid' || !Array.isArray(b.services) || !Array.isArray(b.staff)) return res.status(400).json({ error: 'invalid_backup' });
    store.db.settings = { ...defaultSettings(), ...cleanSettings(b.settings || {}) };
    store.db.staff = b.staff.map((m, i) => ({ id: str(m.id, 20) || crypto.randomBytes(6).toString('base64url'), sort: i + 1, ...cleanMember(m) })).filter((m) => m.name);
    store.db.services = b.services.map((x, i) => ({ id: str(x.id, 20) || crypto.randomBytes(6).toString('base64url'), sort: i + 1, ...cleanService(x, store) })).filter((x) => x.name);
    store.db.blocks = Array.isArray(b.blocks) ? b.blocks.filter((k) => k && A.isDate(k.date)) : [];
    if (Array.isArray(b.bookings)) {
      store.bookings = b.bookings.filter((k) => k && A.isDate(k.date) && B.STATUSES.includes(k.status) && k.token);
      store.db.nextBookingNo = store.bookings.reduce((m, k) => Math.max(m, (k.no || 0) + 1), 1001);
      store.saveBookings();
    }
    store.save();
    res.json({ ok: true });
  });

  api.use('/admin', admin);
  app.use('/api', api);

  app.get('/admin/poster', async (req, res) => {
    if (!auth.isAuthenticated(req, store.db)) return res.redirect('/admin');
    const url = baseUrl(req);
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    res.type('html').send(renderPoster({ settings: store.settings, svg, lang: store.settings.lang, url }));
  });

  app.use((req, res) => res.status(404).type('text').send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(err);
    notify.alertError(store, 'Mawid', err);
    res.status(500).json({ error: 'server_error' });
  });

  if (!demo) {
    backup.schedule(store, { snapshot, mailer, alert: (text) => notify.alertOwner(store, text), appName: 'Mawid' });
    setInterval(sendReminders, 60 * 60 * 1000).unref();
  }
  app.locals.runReminders = sendReminders;
  app.locals.store = store;
  app.locals.setupCode = store.db.setupCode;
  return app;
}

function computeStats(store, now) {
  const all = store.bookings;
  const active = (b) => b.status !== 'cancelled';
  const inRange = (b, from, to) => b.date >= from && b.date <= to;
  const d = (n) => A.addDays(now.date, n);
  const sum = (list) => Math.round(list.reduce((s, b) => s + (Number(b.price) || 0), 0) * 100) / 100;
  const change = (cur, prev, minPrev = 0) => (prev && prev >= minPrev ? Math.round(((cur - prev) / prev) * 100) : null);

  const last30 = all.filter((b) => inRange(b, d(-30), d(-1)) || (b.date === now.date && b.end <= now.minutes));
  const prev30 = all.filter((b) => inRange(b, d(-60), d(-31)));
  const done = (list) => list.filter((b) => b.status === 'completed');
  const shows = (list) => list.filter((b) => b.status === 'completed' || b.status === 'noshow');
  const noshow30 = last30.filter((b) => b.status === 'noshow').length;

  const today = all.filter((b) => b.date === now.date && active(b)).sort((a, b) => a.start - b.start);
  const upcoming = all.filter((b) => inRange(b, d(1), d(7)) && ['pending', 'confirmed'].includes(b.status));
  const tomorrow = all.filter((b) => b.date === d(1) && b.status === 'confirmed').sort((a, b) => a.start - b.start);
  const pending = all.filter((b) => b.status === 'pending' && b.date >= now.date).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

  const weekdays = Array(7).fill(0);
  for (const b of last30) if (active(b)) weekdays[A.dayOfWeek(b.date)]++;
  const top = new Map();
  for (const b of last30.filter(active)) {
    const t = top.get(b.serviceName) || { name: b.serviceName, emoji: b.emoji, count: 0 };
    t.count++;
    top.set(b.serviceName, t);
  }

  let visits = 0;
  for (let i = 0; i < 30; i++) visits += store.stats.visits[d(-i)] || 0;
  const onlineCreated = all.filter((b) => b.source === 'online' && b.createdAt && Date.now() - Date.parse(b.createdAt) < 30 * 864e5).length;

  return {
    today: { count: today.length, revenue: sum(today) },
    upcoming: { count: upcoming.length },
    revenue: { month: sum(done(last30)), change: change(sum(done(last30)), sum(done(prev30)), 1) },
    noshow: { rate: shows(last30).length ? Math.round((noshow30 / shows(last30).length) * 100) : 0, count: noshow30 },
    visits: { month: visits, conversion: visits ? Math.min(100, Math.round((onlineCreated / visits) * 1000) / 10) : 0 },
    todayList: today,
    remind: tomorrow,
    pending,
    weekdays,
    top: [...top.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    services: store.db.services.length,
    staff: store.db.staff.length,
    latestNo: all.reduce((m, b) => Math.max(m, b.no || 0), 0),
  };
}

module.exports = { createApp, intlPhone, generateSetupCode };
