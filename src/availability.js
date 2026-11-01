'use strict';

// Availability engine.
//
// All times are local to the business: a date is "YYYY-MM-DD" and a time is
// minutes after midnight (600 = 10:00). The business's time zone is only used
// to work out what "now" is.

// Bookings still to come (can be cancelled, count towards staff load).
const ACTIVE = ['pending', 'confirmed'];
// Everything except a cancellation occupies its time slot.
const occupies = (b) => b.status !== 'cancelled';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- date helpers ----------
function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** { date, minutes } right now in the given IANA time zone. */
function nowIn(timezone, at = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return nowIn('', at);
  }
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

const fmtTime = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ---------- staff & hours ----------

/** Staff who can perform a service. With no team set up, the business itself is the only "staff". */
function staffFor(service, staff) {
  const active = staff.filter((s) => s.active !== false);
  if (!active.length) return [{ id: '', name: '' }];
  const ids = Array.isArray(service.staffIds) ? service.staffIds : [];
  return ids.length ? active.filter((s) => ids.includes(s.id)) : active;
}

/** Working window [from, to) in minutes for a staff member on a date, or null if off. */
function workingHours(settings, member, date) {
  const dow = dayOfWeek(date);
  const week = member && member.hours && Array.isArray(member.hours) ? member.hours : settings.hours;
  const day = week && week[dow];
  if (!day || !day.open) return null;
  const from = toMin(day.from);
  let to = toMin(day.to);
  if (to <= from) to = 24 * 60; // "until midnight"
  return [from, to];
}

/** Busy intervals [start, end) for one staff member on a date (bookings incl. their buffer, plus time off). */
function busyFor(memberId, date, { bookings, blocks, services }) {
  const busy = [];
  for (const b of bookings) {
    if (b.date !== date || !occupies(b)) continue;
    if ((b.staffId || '') !== (memberId || '')) continue;
    const svc = services.find((s) => s.id === b.serviceId);
    const buffer = b.buffer !== undefined ? b.buffer : svc ? Number(svc.buffer) || 0 : 0;
    busy.push([b.start, b.end + buffer]);
  }
  for (const k of blocks) {
    if (k.date !== date) continue;
    if (k.staffId && k.staffId !== memberId) continue;
    busy.push(k.allDay ? [0, 24 * 60] : [k.from, k.to]);
  }
  return busy;
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * Free start times on a date for a service.
 * Returns [{ start, staffIds: [...] }] sorted by start.
 *
 * opts.ignoreRules: skip minimum notice / booking horizon (used for manual bookings by the owner).
 * opts.excludeBookingId: ignore one booking (e.g. when rescheduling it).
 */
function slotsFor({ settings, service, staff, bookings, blocks, services, date, now, staffId = '', ignoreRules = false, excludeBookingId = '' }) {
  if (!isDate(date) || !service) return [];
  const step = Math.max(5, Number(settings.slotStep) || 30);
  const duration = Math.max(5, Number(service.duration) || 30);
  const buffer = Math.max(0, Number(service.buffer) || 0);

  if (!ignoreRules) {
    const ahead = daysBetween(now.date, date);
    if (ahead < 0 || ahead > (Number(settings.maxDays) || 30)) return [];
  }
  const earliest = ignoreRules || date !== now.date ? -1 : now.minutes + (Number(settings.minNotice) || 0);
  if (!ignoreRules && daysBetween(now.date, date) === 0 && earliest >= 24 * 60) return [];

  let members = staffFor(service, staff);
  if (staffId) members = members.filter((m) => m.id === staffId);
  const ctx = { bookings: bookings.filter((b) => b.id !== excludeBookingId), blocks, services };

  const byStart = new Map();
  for (const m of members) {
    const hours = workingHours(settings, m.id ? m : null, date);
    if (!hours) continue;
    const busy = busyFor(m.id, date, ctx);
    for (let t = hours[0]; t + duration <= hours[1]; t += step) {
      if (t < earliest) continue;
      const end = t + duration + buffer;
      if (busy.some(([b0, b1]) => overlaps(t, end, b0, b1))) continue;
      if (!byStart.has(t)) byStart.set(t, []);
      byStart.get(t).push(m.id);
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, staffIds]) => ({ start, staffIds }));
}

/** Which of the next N days have at least one free slot. */
function openDays(args, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(args.now.date, i);
    out.push({ date, available: slotsFor({ ...args, date }).length > 0 });
  }
  return out;
}

/** Pick a staff member for "anyone": the one with the fewest bookings that day, so work is spread fairly. */
function pickStaff(staffIds, date, bookings) {
  if (staffIds.length <= 1) return staffIds[0] || '';
  const load = (id) => bookings.filter((b) => b.date === date && b.staffId === id && ACTIVE.includes(b.status)).length;
  return [...staffIds].sort((a, b) => load(a) - load(b))[0];
}

module.exports = {
  ACTIVE,
  isDate,
  addDays,
  dayOfWeek,
  daysBetween,
  nowIn,
  toMin,
  fmtTime,
  staffFor,
  workingHours,
  slotsFor,
  openDays,
  pickStaff,
};
