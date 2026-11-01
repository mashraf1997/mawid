'use strict';

const A = require('./availability');
const { strings } = require('./i18n');

const STATUSES = ['pending', 'confirmed', 'completed', 'noshow', 'cancelled'];

function round2(n) {
  return Math.round(n * 100) / 100;
}

const PREFIX_SYMBOLS = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
function formatMoney(amount, currency) {
  const n = round2(Number(amount) || 0);
  const str = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (!currency) return str;
  return PREFIX_SYMBOLS.includes(currency) ? `${currency}${str}` : `${str} ${currency}`;
}

const clean = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---------- labels ----------
function dateLabel(date, lang, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  try {
    return new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

function timeLabel(minutes, lang) {
  const d = new Date(Date.UTC(2024, 0, 1, Math.floor(minutes / 60), minutes % 60));
  try {
    return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
  } catch {
    return A.fmtTime(minutes);
  }
}

function durationLabel(min, t) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} ${t.min}`;
  return m ? `${h} ${t.hr} ${m} ${t.min}` : `${h} ${t.hr}`;
}

// ---------- creating bookings ----------

/**
 * Validates a booking request against live availability.
 * Returns { booking } or { error }.
 * admin: true for bookings the owner adds by hand (no notice/horizon rules, status confirmed).
 */
function buildBooking(input, store, { now, admin = false } = {}) {
  const s = store.settings;
  if (!admin && !s.acceptingBookings) return { error: 'closed' };
  const service = store.get('services', input && input.serviceId);
  if (!service || (!admin && service.active === false)) return { error: 'invalid_service' };
  if (!A.isDate(input.date)) return { error: 'invalid_date' };
  const start = Number(input.start);
  if (!Number.isInteger(start) || start < 0 || start >= 24 * 60) return { error: 'invalid_time' };

  const staff = store.db.staff;
  const requested = clean(input.staffId, 20);
  const slots = A.slotsFor({
    settings: s,
    service,
    staff,
    bookings: store.bookings,
    blocks: store.db.blocks,
    services: store.db.services,
    date: input.date,
    now,
    staffId: requested,
    ignoreRules: admin,
    excludeBookingId: input.excludeBookingId || '',
  });
  const slot = slots.find((x) => x.start === start);
  if (!slot) return { error: 'slot_taken' };
  const staffId = requested || A.pickStaff(slot.staffIds, input.date, store.bookings);
  const member = staff.find((m) => m.id === staffId);

  const c = input.customer || {};
  const customer = { name: clean(c.name, 80), phone: clean(c.phone, 30), notes: clean(c.notes, 500) };
  if (!customer.name) return { error: 'name_required' };
  if (!admin && !customer.phone) return { error: 'phone_required' };

  const duration = Number(service.duration) || 30;
  const price = Number(service.price) || 0;
  // Online bookings can require a deposit; they stay pending until the owner marks it received.
  const pct = admin ? 0 : Math.min(100, Math.max(0, Number(s.depositPercent) || 0));
  const deposit = pct && price ? round2((price * pct) / 100) : 0;
  return {
    booking: {
      serviceId: service.id,
      serviceName: service.name,
      emoji: service.emoji || '',
      staffId: staffId || '',
      staffName: member ? member.name : '',
      date: input.date,
      start,
      end: start + duration,
      duration,
      buffer: Number(service.buffer) || 0,
      price,
      deposit,
      depositPaid: false,
      customer,
      status: !deposit && (admin || s.autoConfirm) ? 'confirmed' : 'pending',
      source: admin ? 'admin' : 'online',
    },
  };
}

/** Can the customer still cancel this booking themselves? */
function canCustomerCancel(b, settings, now) {
  if (!A.ACTIVE.includes(b.status)) return false;
  const minutesUntil = A.daysBetween(now.date, b.date) * 1440 + b.start - now.minutes;
  return minutesUntil >= (Number(settings.cancelHours) || 0) * 60;
}

// ---------- messages ----------
function bookingMessage(b, settings, manageUrl) {
  const t = strings(settings.lang);
  const lang = settings.lang;
  const line = '━━━━━━━━━━';
  const out = [`📅 *${t.msgNewBooking} #${b.no}*`, `🏪 ${settings.name}`, line];
  out.push(`${b.emoji || '✨'} ${b.serviceName} · ${durationLabel(b.duration, t)}${b.price ? ` — ${formatMoney(b.price, settings.currency)}` : ''}`);
  if (b.staffName) out.push(`👤 ${t.msgWith}: ${b.staffName}`);
  out.push(`🗓️ ${dateLabel(b.date, lang)} · ${timeLabel(b.start, lang)}`);
  out.push(line);
  out.push(`🙋 ${t.msgCustomer}: ${b.customer.name}`);
  if (b.customer.phone) out.push(`📞 ${t.msgPhone}: ${b.customer.phone}`);
  if (b.customer.notes) out.push(`📝 ${t.msgNotes}: ${b.customer.notes}`);
  if (b.deposit) out.push(`💳 ${t.msgDeposit}: ${formatMoney(b.deposit, settings.currency)}${b.depositPaid ? ' ✓' : ` (${t.msgUnpaid})`}`);
  if (b.status === 'pending') out.push('', `⏳ ${t.msgPending}`);
  if (manageUrl) out.push('', `🔗 ${manageUrl}`);
  return out.join('\n');
}

function cancelMessage(b, settings) {
  const t = strings(settings.lang);
  return [`❌ *${t.msgCancelledByCustomer} #${b.no}*`, `${b.emoji || '✨'} ${b.serviceName}${b.staffName ? ` · ${b.staffName}` : ''}`, `🗓️ ${dateLabel(b.date, settings.lang)} · ${timeLabel(b.start, settings.lang)}`, `🙋 ${b.customer.name}`].join('\n');
}

function reminderMessage(b, settings, manageUrl) {
  const t = strings(settings.lang);
  const lang = settings.lang;
  return t.msgReminder
    .replace('{name}', b.customer.name.split(' ')[0])
    .replace('{service}', b.serviceName)
    .replace('{shop}', settings.name)
    .replace('{date}', dateLabel(b.date, lang))
    .replace('{time}', timeLabel(b.start, lang))
    .concat(b.staffName ? `\n👤 ${b.staffName}` : '', settings.address ? `\n📍 ${settings.address}` : '', manageUrl ? `\n\n🔗 ${manageUrl}` : '');
}

function whatsappUrl(number, text) {
  const digits = String(number || '').replace(/\D/g, '');
  const q = `text=${encodeURIComponent(text)}`;
  return digits ? `https://wa.me/${digits}?${q}` : `https://wa.me/?${q}`;
}

// ---------- calendar file ----------

/** Converts a local wall-clock time in a time zone to a UTC Date. */
function zonedToUtc(date, minutes, timezone) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const n = A.nowIn(timezone, new Date(guess));
    const [ny, nm, nd] = n.date.split('-').map(Number);
    const seen = Date.UTC(ny, nm - 1, nd, Math.floor(n.minutes / 60), n.minutes % 60);
    guess += wall - seen;
  }
  return new Date(guess);
}

const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

function ics(b, settings, manageUrl) {
  const start = zonedToUtc(b.date, b.start, settings.timezone);
  const end = new Date(start.getTime() + b.duration * 60000);
  const summary = `${b.serviceName} — ${settings.name}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mawid//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id}@mawid`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText([b.staffName, manageUrl].filter(Boolean).join('\n'))}`,
    settings.address ? `LOCATION:${icsText(settings.address)}` : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

module.exports = {
  STATUSES,
  formatMoney,
  dateLabel,
  timeLabel,
  durationLabel,
  buildBooking,
  canCustomerCancel,
  bookingMessage,
  cancelMessage,
  reminderMessage,
  whatsappUrl,
  zonedToUtc,
  ics,
};
