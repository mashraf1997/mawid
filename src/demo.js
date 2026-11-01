'use strict';

// Demo mode: a public, self-resetting showcase (DEMO_MODE=true).

const auth = require('./auth');
const A = require('./availability');
const { loadSample } = require('./sample');

const DEMO_PASSWORD = 'demo1234';

function demoConfig(env = process.env) {
  if (!/^(1|true|yes)$/i.test(env.DEMO_MODE || '')) return null;
  return {
    password: env.DEMO_PASSWORD || DEMO_PASSWORD,
    resetMinutes: Math.max(5, Number(env.DEMO_RESET_MINUTES) || 60),
    lang: env.DEMO_LANG || 'en',
    type: env.DEMO_TYPE || 'salon',
  };
}

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const NAMES_AR = ['سارة', 'لينا', 'هنا', 'نور', 'يارا', 'سلمى', 'دينا', 'منى', 'رنا', 'فرح', 'آدم', 'عمر', 'علي', 'كريم', 'يوسف'];
const NAMES = ['Maya', 'Lina', 'Hana', 'Nour', 'Yara', 'Salma', 'Dina', 'Mona', 'Rana', 'Farah', 'Adam', 'Omar', 'Ali', 'Karim', 'Youssef'];

/** Fills the last 30 days and next 7 days with realistic, non-overlapping bookings. */
function seedBookings(store, now) {
  const r = rng(11);
  const names = store.settings.lang === 'ar' ? NAMES_AR : NAMES;
  const services = store.db.services;
  for (let d = -30; d <= 7; d++) {
    const date = A.addDays(now.date, d);
    const target = Math.round((d >= 0 ? 4 : 5) + r() * 5);
    for (let k = 0; k < target; k++) {
      const service = services[Math.floor(r() * services.length)];
      const slots = A.slotsFor({
        settings: store.settings,
        service,
        staff: store.db.staff,
        bookings: store.bookings,
        blocks: store.db.blocks,
        services,
        date,
        now,
        ignoreRules: true,
      });
      if (!slots.length) continue;
      const slot = slots[Math.floor(r() * slots.length)];
      const staffId = slot.staffIds[Math.floor(r() * slot.staffIds.length)];
      const member = store.db.staff.find((m) => m.id === staffId);
      const isPast = d < 0 || (d === 0 && slot.start + service.duration <= now.minutes);
      let status = 'confirmed';
      if (isPast) {
        const x = r();
        status = x < 0.84 ? 'completed' : x < 0.92 ? 'noshow' : 'cancelled';
      } else if (r() < 0.15) status = 'pending';
      const name = names[Math.floor(r() * names.length)];
      store.bookings.push({
        id: `demo${store.bookings.length}`,
        no: store.db.nextBookingNo++,
        token: `demo-token-${store.bookings.length}`,
        createdAt: new Date(Date.parse(`${date}T00:00:00Z`) - Math.floor(r() * 5) * 864e5).toISOString(),
        reminded: d < 1,
        serviceId: service.id,
        serviceName: service.name,
        emoji: service.emoji,
        staffId: staffId || '',
        staffName: member ? member.name : '',
        date,
        start: slot.start,
        end: slot.start + service.duration,
        duration: service.duration,
        buffer: service.buffer,
        price: service.price,
        customer: { name, phone: `+1 415 555 01${10 + Math.floor(r() * 89)}`, notes: r() < 0.15 ? (store.settings.lang === 'ar' ? 'أول زيارة' : 'First visit') : '' },
        status,
        source: r() < 0.8 ? 'online' : 'admin',
      });
    }
  }
  for (let d = 0; d < 30; d++) {
    store.stats.visits[A.addDays(now.date, -d)] = 30 + Math.floor(r() * 50);
  }
}

function resetDemo(store, cfg) {
  store.reset();
  const ar = cfg.lang === 'ar';
  store.updateSettings({
    name: ar ? 'ستوديو لونا' : 'Studio Luna',
    lang: cfg.lang,
    currency: ar ? 'ج.م' : '$',
    whatsapp: '',
    color: '#db2777',
    theme: 'soft',
    font: 'plex',
    phone: '+1 415 555 0100',
    address: ar ? 'شارع 9، المعادي' : '12 Market St',
    instagram: '@mawid',
    hours: Array.from({ length: 7 }, (_, i) => ({ open: i !== 5, from: '09:00', to: '21:00' })),
    policy: ar ? 'من فضلك تعال قبل ميعادك بـ 5 دقايق.' : 'Please arrive 5 minutes early.',
  });
  store.db.auth = auth.hashPassword(cfg.password);
  store.db.setupDone = true;
  loadSample(store, cfg.type, cfg.lang);
  seedBookings(store, A.nowIn(store.settings.timezone));
  store.save();
  store.saveBookings();
  store.flushStats(true);
}

module.exports = { demoConfig, resetDemo, seedBookings, DEMO_PASSWORD };
