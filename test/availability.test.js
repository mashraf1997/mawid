'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/availability');

const week = (from, to, closed = []) => Array.from({ length: 7 }, (_, i) => ({ open: !closed.includes(i), from, to }));
const settings = { hours: week('09:00', '17:00', [5]), slotStep: 30, minNotice: 60, maxDays: 14 };
const haircut = { id: 'cut', duration: 30, buffer: 0, staffIds: [] };
const color = { id: 'color', duration: 90, buffer: 15, staffIds: ['sara'] };
const services = [haircut, color];
const staff = [
  { id: 'omar', name: 'Omar', active: true },
  { id: 'sara', name: 'Sara', active: true, hours: week('12:00', '20:00') },
];
// Monday 2026-11-02, 08:00 local
const now = { date: '2026-11-02', minutes: 8 * 60 };
const base = { settings, services, staff, bookings: [], blocks: [], now };
const starts = (slots) => slots.map((s) => A.fmtTime(s.start));

test('date helpers', () => {
  assert.equal(A.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(A.dayOfWeek('2026-11-02'), 1);
  assert.equal(A.daysBetween('2026-11-02', '2026-11-16'), 14);
  assert.ok(A.isDate('2028-02-29'));
  assert.ok(!A.isDate('2026-02-30'));
  assert.ok(!A.isDate('2026-1-1'));
  const n = A.nowIn('Africa/Cairo', new Date('2026-11-02T22:30:00Z'));
  assert.deepEqual(n, { date: '2026-11-03', minutes: 30 }); // Cairo is UTC+2 in November
});

test('slots respect each staff member\'s hours and merge by start time', () => {
  const slots = A.slotsFor({ ...base, service: haircut, date: '2026-11-03' });
  assert.equal(starts(slots)[0], '09:00');
  assert.equal(starts(slots).at(-1), '19:30'); // Sara works until 20:00
  const noon = slots.find((s) => s.start === 12 * 60);
  assert.deepEqual(noon.staffIds.sort(), ['omar', 'sara']);
  const morning = slots.find((s) => s.start === 9 * 60);
  assert.deepEqual(morning.staffIds, ['omar']);
});

test('services can be limited to some staff, and staff can be chosen', () => {
  const slots = A.slotsFor({ ...base, service: color, date: '2026-11-03' });
  assert.equal(starts(slots)[0], '12:00');
  assert.equal(starts(slots).at(-1), '18:30'); // 90 min must end by 20:00
  assert.ok(slots.every((s) => s.staffIds.join() === 'sara'));
  assert.equal(A.slotsFor({ ...base, service: haircut, date: '2026-11-03', staffId: 'omar' }).at(-1).start, 16 * 60 + 30);
});

test('existing bookings and their buffer block overlapping slots', () => {
  const bookings = [{ id: 'b1', date: '2026-11-03', start: 13 * 60, end: 14 * 60 + 30, staffId: 'sara', serviceId: 'color', status: 'confirmed' }];
  const slots = A.slotsFor({ ...base, bookings, service: color, date: '2026-11-03' });
  const s = starts(slots);
  assert.ok(!s.includes('12:00'), '12:00 + 90 + 15 buffer runs into the 13:00 booking');
  assert.ok(!s.includes('14:30'), 'blocked by the previous booking\'s 15 min buffer');
  assert.ok(s.includes('15:00'));
  assert.ok(s.includes('11:30') === false);
  // Completed / no-show bookings still occupied their time
  const done = [{ ...bookings[0], status: 'completed' }];
  assert.ok(!starts(A.slotsFor({ ...base, bookings: done, service: color, date: '2026-11-03' })).includes('12:00'));
  // Cancelled bookings free the slot again
  const cancelled = [{ ...bookings[0], status: 'cancelled' }];
  assert.ok(starts(A.slotsFor({ ...base, bookings: cancelled, service: color, date: '2026-11-03' })).includes('12:00'));
  // ...and so does excluding it (rescheduling)
  assert.ok(starts(A.slotsFor({ ...base, bookings, service: color, date: '2026-11-03', excludeBookingId: 'b1' })).includes('12:00'));
});

test('time off blocks one person or everyone', () => {
  const blocks = [
    { date: '2026-11-03', staffId: 'omar', from: 9 * 60, to: 12 * 60 },
    { date: '2026-11-04', staffId: '', allDay: true },
  ];
  const tue = A.slotsFor({ ...base, blocks, service: haircut, date: '2026-11-03' });
  assert.ok(!tue.some((s) => s.start < 12 * 60), 'Omar is off in the morning and Sara starts at 12');
  assert.deepEqual(A.slotsFor({ ...base, blocks, service: haircut, date: '2026-11-04' }), []);
});

test('minimum notice, booking horizon, closed days', () => {
  const today = A.slotsFor({ ...base, service: haircut, date: '2026-11-02', now: { date: '2026-11-02', minutes: 10 * 60 + 10 } });
  assert.equal(starts(today)[0], '11:30', '10:10 + 60 min notice → first slot 11:30');
  assert.deepEqual(A.slotsFor({ ...base, service: haircut, date: '2026-11-01' }), [], 'past');
  assert.deepEqual(A.slotsFor({ ...base, service: haircut, date: '2026-11-17' }), [], 'beyond 14 days');
  const friday = A.slotsFor({ ...base, service: haircut, date: '2026-11-06' });
  assert.ok(friday.every((s) => s.staffIds.join() === 'sara'), 'business closed Friday, but Sara has her own hours');
  // Owner bookings ignore notice and horizon
  assert.ok(A.slotsFor({ ...base, service: haircut, date: '2026-11-30', ignoreRules: true }).length > 0);
});

test('no team: the business itself takes one booking at a time', () => {
  const solo = { ...base, staff: [] };
  const bookings = [{ id: 'x', date: '2026-11-03', start: 600, end: 630, staffId: '', serviceId: 'cut', status: 'pending' }];
  const s = starts(A.slotsFor({ ...solo, bookings, service: haircut, date: '2026-11-03' }));
  assert.ok(!s.includes('10:00'));
  assert.ok(s.includes('10:30'));
});

test('open days and fair staff picking', () => {
  const days = A.openDays({ ...base, service: color }, 7);
  assert.equal(days.length, 7);
  assert.ok(days.every((d) => d.available));
  const bookings = [{ date: '2026-11-03', staffId: 'omar', status: 'confirmed' }];
  assert.equal(A.pickStaff(['omar', 'sara'], '2026-11-03', bookings), 'sara');
});

test('"until midnight" hours', () => {
  const late = { ...base, settings: { ...settings, hours: week('18:00', '00:00') } };
  const s = starts(A.slotsFor({ ...late, staff: [], service: haircut, date: '2026-11-03' }));
  assert.equal(s.at(-1), '23:30');
});
