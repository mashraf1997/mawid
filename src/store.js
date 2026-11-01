'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BOOKINGS = 20000;
const VISIT_DAYS = 120;

const newId = () => crypto.randomBytes(6).toString('base64url');
const newToken = () => crypto.randomBytes(12).toString('base64url');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

// Write to a temp file then rename, so a crash mid-write never corrupts data.
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const defaultHours = () =>
  Array.from({ length: 7 }, (_, i) => ({ open: i !== 5, from: '10:00', to: '20:00' }));

function defaultSettings() {
  return {
    name: 'My Studio',
    tagline: '',
    about: '',
    logo: '',
    cover: '',
    whatsapp: '',
    phone: '',
    address: '',
    mapUrl: '',
    instagram: '',
    facebook: '',
    tiktok: '',
    currency: 'EGP',
    lang: 'ar',
    color: '#7c3aed',
    theme: 'fresh',
    font: 'cairo',
    timezone: '',
    hours: defaultHours(),
    acceptingBookings: true,
    autoConfirm: true,
    slotStep: 30,
    minNotice: 60,
    maxDays: 30,
    cancelHours: 3,
    policy: '',
  };
}

function defaultDb() {
  return {
    version: 1,
    setupDone: false,
    secret: crypto.randomBytes(32).toString('hex'),
    auth: null,
    settings: defaultSettings(),
    services: [],
    staff: [],
    blocks: [],
    nextBookingNo: 1001,
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.dbFile = path.join(dir, 'db.json');
    this.bookingsFile = path.join(dir, 'bookings.json');
    this.statsFile = path.join(dir, 'stats.json');

    const db = readJson(this.dbFile);
    this.db = db || defaultDb();
    this.db.settings = { ...defaultSettings(), ...this.db.settings };
    for (const k of ['services', 'staff', 'blocks']) if (!Array.isArray(this.db[k])) this.db[k] = [];
    this.bookings = readJson(this.bookingsFile) || [];
    this.stats = readJson(this.statsFile) || { visits: {} };
    if (!db) this.save();
  }

  save() {
    writeJsonAtomic(this.dbFile, this.db);
  }

  saveBookings() {
    if (this.bookings.length > MAX_BOOKINGS) this.bookings = this.bookings.slice(-MAX_BOOKINGS);
    writeJsonAtomic(this.bookingsFile, this.bookings);
  }

  get settings() {
    return this.db.settings;
  }

  updateSettings(patch) {
    this.db.settings = { ...this.db.settings, ...patch };
    this.save();
    return this.db.settings;
  }

  /** Wipes everything except the signing secret (demo mode). */
  reset() {
    const secret = this.db.secret;
    this.db = defaultDb();
    this.db.secret = secret;
    this.bookings = [];
    this.stats = { visits: {} };
    for (const f of fs.readdirSync(this.uploadsDir)) fs.rmSync(path.join(this.uploadsDir, f), { force: true });
    this.save();
    this.saveBookings();
    this.flushStats(true);
  }

  // ---- generic sorted collections: services, staff ----
  sorted(collection) {
    return [...this.db[collection]].sort((a, b) => a.sort - b.sort);
  }

  get(collection, id) {
    return this.db[collection].find((x) => x.id === id) || null;
  }

  add(collection, data, { save = true } = {}) {
    const sort = this.db[collection].reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const item = { id: newId(), sort, ...data };
    this.db[collection].push(item);
    if (save) this.save();
    return item;
  }

  update(collection, id, data) {
    const item = this.get(collection, id);
    if (!item) return null;
    Object.assign(item, data);
    this.save();
    return item;
  }

  remove(collection, id) {
    const item = this.get(collection, id);
    if (!item) return null;
    this.db[collection] = this.db[collection].filter((x) => x.id !== id);
    if (collection === 'staff') {
      for (const s of this.db.services) s.staffIds = (s.staffIds || []).filter((x) => x !== id);
      this.db.blocks = this.db.blocks.filter((b) => b.staffId !== id);
    }
    this.save();
    return item;
  }

  reorder(collection, ids) {
    ids.forEach((id, i) => {
      const item = this.get(collection, id);
      if (item) item.sort = i + 1;
    });
    this.save();
  }

  // ---- bookings ----
  getBooking(id) {
    return this.bookings.find((b) => b.id === id) || null;
  }

  byToken(token) {
    return (token && this.bookings.find((b) => b.token === token)) || null;
  }

  addBooking(data) {
    const booking = {
      id: newId(),
      no: this.db.nextBookingNo++,
      token: newToken(),
      createdAt: new Date().toISOString(),
      reminded: false,
      ...data,
    };
    this.save();
    this.bookings.push(booking);
    this.saveBookings();
    return booking;
  }

  updateBooking(id, data) {
    const b = this.getBooking(id);
    if (!b) return null;
    Object.assign(b, data, { updatedAt: new Date().toISOString() });
    this.saveBookings();
    return b;
  }

  // ---- visits (written at most every few seconds) ----
  recordVisit(date = localDate()) {
    this.stats.visits[date] = (this.stats.visits[date] || 0) + 1;
    this.statsDirty = true;
    if (!this.statsTimer) {
      this.statsTimer = setTimeout(() => this.flushStats(), 5000);
      this.statsTimer.unref();
    }
  }

  flushStats(force) {
    clearTimeout(this.statsTimer);
    this.statsTimer = null;
    if (!this.statsDirty && !force) return;
    const keep = Object.keys(this.stats.visits).sort().slice(-VISIT_DAYS);
    this.stats.visits = Object.fromEntries(keep.map((k) => [k, this.stats.visits[k]]));
    writeJsonAtomic(this.statsFile, this.stats);
    this.statsDirty = false;
  }

  // ---- uploads ----
  isImageInUse(url) {
    const s = this.db.settings;
    if (s.logo === url || s.cover === url) return true;
    return this.db.staff.some((m) => m.photo === url) || this.db.services.some((x) => x.image === url);
  }

  removeUploadIfUnused(url) {
    if (!url || !url.startsWith('/uploads/') || this.isImageInUse(url)) return;
    fs.rm(path.join(this.uploadsDir, path.basename(url)), { force: true }, () => {});
  }
}

module.exports = { Store, defaultSettings, defaultHours, newId, localDate };
