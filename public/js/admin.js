(() => {
  'use strict';

  // ======================= i18n =======================
  const LANG_KEY = 'mawid-admin-lang';
  let lang = (() => {
    try { return localStorage.getItem(LANG_KEY); } catch { return null; }
  })();
  let S = {};
  let LANGUAGES = [{ code: 'en', name: 'English' }];
  const T = (k) => S[k] || k;

  async function setLang(next) {
    const data = await (await fetch(`/api/i18n/${encodeURIComponent(next || 'en')}`)).json();
    S = data.strings;
    LANGUAGES = data.languages;
    lang = LANGUAGES.some((l) => l.code === next) ? next : 'en';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = T('dir');
  }

  // ======================= helpers =======================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ICONS = '/img/icons.svg';
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
  const hue = (text) => {
    let h = 0;
    for (const ch of String(text || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  };
  const trend = (pct) =>
    pct === null || pct === undefined ? '' : `<span class="trend ${pct >= 0 ? 'up' : 'down'}" title="${esc(T('vsPrevious'))}">${ic(pct >= 0 ? 'trend-up' : 'trend-down')}${Math.abs(pct)}%</span>`;

  let toastTimer;
  function toast(msg, bad) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Mawid': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/password')) {
      boot();
      throw new Error('unauthorized');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }

  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
    const cur = state.data ? state.data.settings.currency : '';
    return PREFIX.includes(cur) ? `${cur}${s}` : `${s} ${cur}`.trim();
  };
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const toMin = (s) => {
    const [h, m] = String(s).split(':').map(Number);
    return h * 60 + m;
  };
  const timeLabel = (min) => new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, Math.floor(min / 60), min % 60)));
  const fmtDate = (date, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const addDays = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayName = (i, style = 'long') => new Intl.DateTimeFormat(lang, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));
  const dur = (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return !h ? `${r}m` : r ? `${h}h ${r}m` : `${h}h`;
  };
  const sw = (name, checked, label, attrs = '') =>
    `<label class="check"><span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><i></i></span><span>${label}</span></label>`;
  const browserTimezone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  };
  const timezones = () => {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return []; }
  };

  async function fileToDataUrl(file, max) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let data = c.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      return data;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function uploadFile(file, max = 1200) {
    const dataUrl = await fileToDataUrl(file, max);
    return (await api('POST', '/api/admin/upload', { dataUrl })).url;
  }

  // ======================= state =======================
  const state = { data: null, tab: 'home', weekStart: null, calStaff: '', listFilter: 'upcoming', q: '', latestNo: null };
  let demo = null;

  async function loadData() {
    state.data = await api('GET', '/api/admin/data');
    document.documentElement.style.setProperty('--brand', state.data.settings.color);
  }
  const today = () => state.data.now.date;
  const staffById = (id) => state.data.staff.find((m) => m.id === id);
  const serviceById = (id) => state.data.services.find((s) => s.id === id);
  const statusChip = (s) => `<span class="chip ${s}">${esc(T(`st_${s}`))}</span>`;

  // ======================= boot / auth =======================
  async function boot() {
    let s;
    try {
      s = await api('GET', '/api/state');
    } catch {
      app.innerHTML = '<div class="auth"><div class="auth-main"><p class="error">Error</p></div></div>';
      return;
    }
    demo = s.demo;
    await setLang(lang || s.lang);
    if (!s.setupDone) return renderSetup(s);
    if (!s.authed) return renderLogin();
    await loadData();
    renderShell();
    startPolling();
  }

  const langSwitch = () =>
    `<select class="lang-select" data-act-change="lang" aria-label="Language">${LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
  const langOptions = (selected) => LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const CURRENCY_GUESS = { ar: 'EGP', en: 'USD', es: 'MXN', pt: 'BRL', fr: 'EUR', tr: 'TRY', id: 'IDR', hi: 'INR' };

  const authShell = (form) => `
    <div class="auth">
      <aside class="auth-side">
        <div class="auth-brand"><img src="/img/icon.svg" alt="" width="40" height="40"><b>Mawid</b></div>
        <h2>${esc(T('authTagline'))}</h2>
        <ul>${['authPoint1', 'authPoint2', 'authPoint3'].map((k) => `<li>${ic('check')}<span>${esc(T(k))}</span></li>`).join('')}</ul>
        <div class="auth-mock" aria-hidden="true">
          <div class="m-bubble">📅 <b>#1042</b> · ✂️ Haircut + beard<br><small>Tue 3 Nov · 10:30 · Omar</small></div>
          <div class="m-bubble me">✅ ${esc(T('st_confirmed'))}</div>
        </div>
      </aside>
      <div class="auth-main">${form}</div>
    </div>`;

  function renderSetup(s) {
    app.innerHTML = authShell(`<form class="auth-card" id="setup" autocomplete="off">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('setupTitle'))}</h1>
        <p class="sub">${esc(T('setupSub'))}</p>
        ${s.needsSetupCode ? `<label class="field"><span>${ic('lock')}${esc(T('setupCode'))}</span><input name="setupCode" required maxlength="12" placeholder="ABCD-EFGH" autocapitalize="characters" spellcheck="false" style="letter-spacing:.15em;font-weight:700"><small>${esc(T('setupCodeHint'))}</small></label>` : ''}
        <label class="field"><span>${esc(T('businessName'))}</span><input name="name" required maxlength="80"></label>
        <label class="field"><span>${esc(T('businessType'))}</span><select name="type">${s.businessTypes.map((k) => `<option value="${k}">${esc(T(`type_${k}`))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" inputmode="tel" maxlength="20" placeholder="201001234567"><small>${esc(T('whatsappHint'))}</small></label>
        <div class="grid2">
          <label class="field"><span>${esc(T('currency'))}</span><input name="currency" value="${CURRENCY_GUESS[lang] || 'USD'}" maxlength="12"></label>
          <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(lang)}</select></label>
        </div>
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required minlength="8" autocomplete="new-password"><small>${esc(T('passwordHint'))}</small></label>
        ${sw('sample', true, `${esc(T('sampleData'))} <small class="muted">— ${esc(T('sampleHint'))}</small>`)}
        <button class="btn block" type="submit">${esc(T('start'))}</button>
        <p class="error" id="err"></p>
      </form>`);
    const f = $('#setup');
    (f.setupCode || f.name).focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.password.value.length < 8) return ($('#err').textContent = T('weakPassword'));
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await api('POST', '/api/setup', {
          setupCode: f.setupCode ? f.setupCode.value : '', name: f.name.value, type: f.type.value, whatsapp: f.whatsapp.value,
          currency: f.currency.value, lang: f.lang.value, password: f.password.value, sample: f.sample.checked, timezone: browserTimezone(),
        });
        await setLang(f.lang.value);
        boot();
      } catch (err) {
        $('#err').textContent = T({ weak_password: 'weakPassword', invalid_setup_code: 'invalidSetupCode', rate_limited: 'rateLimited' }[err.code] || 'error');
        f.querySelector('button[type=submit]').disabled = false;
      }
    });
  }

  function renderLogin() {
    app.innerHTML = authShell(`<form class="auth-card" id="login">
        <div style="text-align:end">${langSwitch()}</div>
        <img class="mark" src="/img/icon.svg" alt="">
        <h1>${esc(T('loginTitle'))}</h1>
        <p class="sub">${esc(T('loginSub'))}</p>
        ${demo ? `<p class="demo-note">${ic('sparkles')} ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></p>` : ''}
        <label class="field"><span>${esc(T('password'))}</span><input name="password" type="password" required autocomplete="current-password" value="${demo ? esc(demo.password) : ''}"></label>
        <button class="btn block" type="submit">${esc(T('login'))}</button>
        <p class="error" id="err"></p>
      </form>`);
    $('#login [name=password]').focus();
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/login', { password: e.target.password.value });
        boot();
      } catch (err) {
        $('#err').textContent = err.code === 'rate_limited' ? T('rateLimited') : T('wrongPassword');
      }
    });
  }

  // ======================= shell =======================
  const TABS = [
    ['home', 'dashboard'], ['calendar', 'calendar'], ['bookings', 'receipt'], ['services', 'scissors'],
    ['team', 'users'], ['appearance', 'palette'], ['share', 'megaphone'], ['settings', 'settings'],
  ];

  function renderShell() {
    const s = state.data.settings;
    const hash = location.hash.slice(1);
    if (TABS.some(([k]) => k === hash)) state.tab = hash;
    app.innerHTML = `
      ${demo ? `<div class="demo-bar">${ic('sparkles')} ${esc(T('demoLogin'))} <b>${esc(demo.password)}</b></div>` : ''}
      <header class="top">
        <img src="${esc(s.logo || '/img/icon.svg')}" alt="" width="36" height="36">
        <div class="shop">${esc(s.name)}<small class="muted"><span class="status-dot ${s.acceptingBookings ? '' : 'off'}"></span>${esc(fmtDate(today(), { weekday: 'long', day: 'numeric', month: 'long' }))}</small></div>
        ${langSwitch()}
        <a class="btn sm" href="/" target="_blank" rel="noopener">${ic('external')}<span class="hide-sm">${esc(T('viewPage'))}</span></a>
        <button class="icon-btn" data-act="logout" title="${esc(T('logout'))}" aria-label="${esc(T('logout'))}" type="button">${ic('logout')}</button>
      </header>
      <div class="layout">
        <nav class="nav">${TABS.map(([k, icon]) => `<button type="button" data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${ic(icon, 'i ico')}<span>${esc(T(k))}</span>${k === 'bookings' ? '<span class="dot" id="pending-dot" hidden></span>' : ''}</button>`).join('')}</nav>
        <main class="view" id="view"></main>
      </div>`;
    renderTab();
  }

  async function renderTab() {
    $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
    const view = $('#view');
    if (!view) return;
    try {
      await VIEWS[state.tab](view);
    } catch (err) {
      if (err.message !== 'unauthorized') {
        console.error(err);
        toast(T('error'), true);
      }
    }
  }

  function setPendingDot(n) {
    const dot = $('#pending-dot');
    if (dot) {
      dot.hidden = !n;
      dot.textContent = n;
    }
    document.title = `${n ? `(${n}) ` : ''}Mawid — ${state.data ? state.data.settings.name : ''}`;
  }

  // ======================= booking card / modal =======================
  const VIEWS = {};
  const staffHue = (id) => {
    const m = staffById(id);
    return m ? hue(m.name) : 270;
  };

  function bookingRow(b, { showDate = false, compact = false } = {}) {
    const isPast = b.date < today() || (b.date === today() && b.end <= state.data.now.minutes);
    const isNow = b.date === today() && b.start <= state.data.now.minutes && b.end > state.data.now.minutes;
    const actions = [];
    const depositDue = b.deposit && !b.depositPaid && ['pending', 'confirmed'].includes(b.status);
    if (!compact && depositDue) actions.push(`<button class="btn sm" data-deposit="${b.id}" type="button">${ic('cash')}<span class="hide-sm">${esc(T('depositReceived'))}</span></button>`);
    else if (!compact && ['pending', 'confirmed'].includes(b.status)) {
      if (b.status === 'pending') actions.push(`<button class="btn sm" data-status="confirmed" data-id="${b.id}" type="button">${ic('check')}<span class="hide-sm">${esc(T('markConfirmed'))}</span></button>`);
      else if (isPast || isNow) actions.push(`<button class="btn sm" data-status="completed" data-id="${b.id}" type="button">${ic('check')}<span class="hide-sm">${esc(T('markCompleted'))}</span></button>`);
    }
    return `<div class="bk${isPast ? ' past' : ''}${isNow ? ' now' : ''}" data-open="${b.id}" style="--sc:hsl(${staffHue(b.staffId)} 60% 50%)">
      <span class="em">${esc(b.emoji || '✨')}</span>
      <div class="bd"><b>${esc(b.customer.name)}</b><span>${esc(b.serviceName)}${b.staffName ? ` · ${esc(b.staffName)}` : ''}${showDate ? ` · ${esc(fmtDate(b.date))} ${esc(timeLabel(b.start))}` : ''}</span></div>
      ${depositDue ? `<span class="chip pending">${ic('cash', 'i xs')}${esc(money(b.deposit))}</span>` : statusChip(b.status)}
      <div class="acts">${actions.join('')}</div>
    </div>`;
  }

  async function setStatus(id, status) {
    await api('PUT', `/api/admin/bookings/${id}`, { status });
    toast(T('saved'));
  }

  async function openWhatsApp(id, kind) {
    const w = window.open('about:blank', '_blank');
    try {
      const { url } = await api('GET', `/api/admin/bookings/${id}/whatsapp${kind ? `?kind=${kind}` : ''}`);
      if (w) w.location = url;
      else location.href = url;
      if (kind === 'reminder') await api('PUT', `/api/admin/bookings/${id}`, { reminded: true });
    } catch {
      if (w) w.close();
      toast(T('error'), true);
    }
  }

  function openModal(html) {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'modal';
    el.innerHTML = `<div class="back" data-close></div><div class="box" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeModal();
    });
    return $('.box', el);
  }
  function closeModal() {
    const m = $('#modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Time options for a service/staff/date from the server (owner rules: no notice limits).
  async function fillTimes(select, { serviceId, staffId, date, exclude, keep }) {
    select.innerHTML = '<option>…</option>';
    const { slots } = await api('GET', `/api/admin/slots?service=${encodeURIComponent(serviceId)}&staff=${encodeURIComponent(staffId || '')}&date=${date}${exclude ? `&exclude=${exclude}` : ''}`);
    select.innerHTML = slots.length
      ? slots.map((s) => `<option value="${s.start}" ${s.start === keep ? 'selected' : ''}>${esc(timeLabel(s.start))}</option>`).join('')
      : `<option value="">${esc(T('noSlots'))}</option>`;
  }

  function staffOptions(serviceId, selected) {
    const svc = serviceById(serviceId);
    const ids = svc && svc.staffIds.length ? svc.staffIds : state.data.staff.map((m) => m.id);
    const people = state.data.staff.filter((m) => ids.includes(m.id) && m.active !== false);
    if (!people.length) return '';
    return `<option value="">${esc(T('anyStaff'))}</option>${people.map((m) => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`;
  }

  function newBookingModal({ date, start, staffId } = {}) {
    const svcs = state.data.services.filter((s) => s.active !== false);
    if (!svcs.length) return toast(T('noServicesYet'), true);
    const box = openModal(`
      <h3>${ic('calendar-plus')}${esc(T('newBooking'))}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('manualHint'))}</p>
      <form id="nb">
        <label class="field"><span>${esc(T('service'))}</span><select name="serviceId">${svcs.map((s) => `<option value="${s.id}">${esc(s.emoji)} ${esc(s.name)} · ${dur(s.duration)}</option>`).join('')}</select></label>
        <label class="field" id="nb-staff-wrap"><span>${esc(T('staff'))}</span><select name="staffId"></select></label>
        <div class="grid2">
          <label class="field"><span>${esc(T('date'))}</span><input name="date" type="date" value="${esc(date || today())}" required></label>
          <label class="field"><span>${esc(T('time'))}</span><select name="start"></select></label>
        </div>
        <div class="grid2">
          <label class="field"><span>${esc(T('customer'))} *</span><input name="name" maxlength="80" required></label>
          <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" maxlength="30"></label>
        </div>
        <label class="field"><span>${esc(T('notes'))}</span><input name="notes" maxlength="500"></label>
        <div class="modal-actions"><button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button><button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button></div>
      </form>`);
    const f = $('#nb', box);
    const refresh = async () => {
      const opts = staffOptions(f.serviceId.value, f.staffId.value || staffId);
      $('#nb-staff-wrap', box).hidden = !opts;
      f.staffId.innerHTML = opts;
      await fillTimes(f.start, { serviceId: f.serviceId.value, staffId: f.staffId.value, date: f.date.value, keep: start });
    };
    f.serviceId.addEventListener('change', refresh);
    f.staffId.addEventListener('change', refresh);
    f.date.addEventListener('change', refresh);
    refresh();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!f.start.value) return toast(T('noSlots'), true);
      try {
        await api('POST', '/api/admin/bookings', {
          serviceId: f.serviceId.value, staffId: f.staffId.value, date: f.date.value, start: Number(f.start.value),
          customer: { name: f.name.value, phone: f.phone.value, notes: f.notes.value },
        });
        closeModal();
        toast(T('saved'));
        renderTab();
      } catch (err) {
        toast(err.code === 'slot_taken' ? T('slotTaken') : err.code === 'name_required' ? `${T('customer')} *` : T('error'), true);
      }
    });
  }

  async function bookingModal(id) {
    const { bookings } = await api('GET', '/api/admin/bookings');
    const b = bookings.find((x) => x.id === id);
    if (!b) return;
    const upcoming = ['pending', 'confirmed'].includes(b.status);
    const box = openModal(`
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:6px">
        <span class="avatar" style="--h:${hue(b.serviceName)};border-radius:16px;font-size:26px">${esc(b.emoji || '✨')}</span>
        <div style="flex:1"><h3 style="margin:0">${esc(b.serviceName)}</h3><span class="muted small">#${b.no} · ${esc(b.source === 'admin' ? T('byYou') : T('online'))}</span></div>
        ${statusChip(b.status)}
      </div>
      <div class="detail">
        <div>${ic('calendar')}<b>${esc(fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(timeLabel(b.start))} – ${esc(timeLabel(b.end))}</b></div>
        ${b.staffName ? `<div>${ic('user')}${esc(b.staffName)}</div>` : ''}
        <div>${ic('users')}<b>${esc(b.customer.name)}</b>${b.customer.phone ? ` · <a href="tel:${esc(b.customer.phone)}">${esc(b.customer.phone)}</a>` : ''}</div>
        ${b.price ? `<div>${ic('cash')}${esc(money(b.price))}${b.deposit ? ` · ${esc(T('deposits'))}: <b>${esc(money(b.deposit))}</b> ${b.depositPaid ? '✓' : `<span class="chip pending">${esc(T('depositDue'))}</span>`}` : ''}</div>` : ''}
        ${b.customer.notes ? `<div>${ic('edit')}${esc(b.customer.notes)}</div>` : ''}
      </div>
      ${upcoming ? `<form id="resched" class="card" style="padding:12px;margin-bottom:12px">
        <div class="inline-fields">
          <label class="field" style="margin:0"><span>${esc(T('date'))}</span><input name="date" type="date" value="${esc(b.date)}"></label>
          <label class="field" style="margin:0"><span>${esc(T('time'))}</span><select name="start"></select></label>
          ${state.data.staff.length ? `<label class="field" style="margin:0"><span>${esc(T('staff'))}</span><select name="staffId">${staffOptions(b.serviceId, b.staffId)}</select></label>` : '<span></span>'}
          <button class="btn sm" type="submit">${ic('check')}${esc(T('save'))}</button>
        </div></form>` : ''}
      <div class="modal-actions" style="flex-wrap:wrap">
        ${b.deposit && !b.depositPaid && upcoming ? `<button class="btn" data-paid="1">${ic('cash')}${esc(T('depositReceived'))}</button>` : ''}
        ${b.status === 'pending' && !(b.deposit && !b.depositPaid) ? `<button class="btn" data-set="confirmed">${ic('check')}${esc(T('markConfirmed'))}</button>` : ''}
        ${upcoming ? `<button class="btn" data-set="completed">${ic('check')}${esc(T('markCompleted'))}</button><button class="btn line" data-set="noshow">${esc(T('markNoshow'))}</button><button class="btn danger" data-set="cancelled">${ic('x')}${esc(T('markCancelled'))}</button>` : `<button class="btn line" data-set="confirmed">${esc(T('reopen'))}</button>`}
        ${b.customer.phone ? `<button class="btn wa" data-wa="">${ic('whatsapp')}${esc(T('chat'))}</button>` : ''}
        ${b.customer.phone && upcoming ? `<button class="btn line" data-wa="reminder">${ic('bell')}${esc(T('remind'))}</button>` : ''}
        <button class="btn ghost" data-close>${esc(T('close'))}</button>
      </div>`);
    const r = $('#resched', box);
    if (r) {
      const refresh = () => fillTimes(r.start, { serviceId: b.serviceId, staffId: r.staffId ? r.staffId.value : b.staffId, date: r.date.value, exclude: b.id, keep: b.start });
      r.date.addEventListener('change', refresh);
      if (r.staffId) r.staffId.addEventListener('change', refresh);
      refresh();
      r.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!r.start.value) return toast(T('noSlots'), true);
        try {
          await api('PUT', `/api/admin/bookings/${b.id}`, { date: r.date.value, start: Number(r.start.value), staffId: r.staffId ? r.staffId.value : b.staffId });
          closeModal();
          toast(T('saved'));
          renderTab();
        } catch {
          toast(T('slotTaken'), true);
        }
      });
    }
    box.addEventListener('click', async (e) => {
      const set = e.target.closest('[data-set]');
      const wa = e.target.closest('[data-wa]');
      if (e.target.closest('[data-paid]')) {
        await api('PUT', `/api/admin/bookings/${b.id}`, { depositPaid: true });
        toast(T('saved'));
        closeModal();
        return renderTab();
      }
      if (set) {
        await setStatus(b.id, set.dataset.set);
        closeModal();
        renderTab();
      } else if (wa) {
        await openWhatsApp(b.id, wa.dataset.wa);
      }
    });
  }

  // ======================= TODAY =======================
  VIEWS.home = async (view) => {
    const st = await api('GET', '/api/admin/stats');
    state.latestNo = st.latestNo;
    setPendingDot(st.pending.length);
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const steps = [
      [!!s.whatsapp, T('stepWhatsapp'), 'settings'],
      [st.services > 0, T('stepServices'), 'services'],
      [st.staff > 0, T('stepTeam'), 'team'],
      [!!s.logo, T('stepLogo'), 'appearance'],
      [st.upcoming.count + st.today.count > 0, T('stepShare'), 'share'],
    ];
    const allDone = demo || steps.every((x) => x[0]);
    const maxWd = Math.max(1, ...st.weekdays);
    const peakWd = st.weekdays.indexOf(Math.max(...st.weekdays));
    const maxTop = Math.max(1, ...st.top.map((x) => x.count));

    view.innerHTML = `
      <div class="page-head">
        <h2 class="title">${esc(T('home'))}</h2>
        <button class="btn" data-act="new" type="button" style="margin-inline-start:auto">${ic('calendar-plus')}${esc(T('newBooking'))}</button>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-ic c1">${ic('calendar')}</div><div class="kpi-body"><span class="label">${esc(T('todayBookings'))}</span><div class="value">${st.today.count}</div><span class="sub">${esc(money(st.today.revenue))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c4">${ic('clock')}</div><div class="kpi-body"><span class="label">${esc(T('upcoming'))}</span><div class="value">${st.upcoming.count}</div><span class="sub">${st.pending.length ? `${st.pending.length} ${esc(T('st_pending'))}` : '&nbsp;'}</span></div></div>
        <div class="kpi"><div class="kpi-ic c2">${ic('cash')}</div><div class="kpi-body"><span class="label">${esc(T('revenue30'))}</span><div class="value">${esc(money(st.revenue.month))}${trend(st.revenue.change)}</div><span class="sub">${st.visits.month} ${esc(T('visitors')).toLowerCase()} · ${st.visits.conversion}% ${esc(T('conversion'))}</span></div></div>
        <div class="kpi"><div class="kpi-ic c3">${ic('x-circle')}</div><div class="kpi-body"><span class="label">${esc(T('noshowRate'))}</span><div class="value">${st.noshow.rate}%</div><span class="sub">${st.noshow.count} · 30d</span></div></div>
      </div>
      ${st.pending.length ? `<div class="card" style="border-color:#fde68a"><h3>${ic('hourglass')}${esc(T('pendingRequests'))}</h3><div class="timeline">${st.pending.map((b) => bookingRow(b, { showDate: true })).join('')}</div></div>` : ''}
      <div class="dash-cols">
        <div>
          <div class="card">
            <h3>${ic('calendar')}${esc(T('schedule'))}</h3>
            ${st.todayList.length ? `<div class="timeline">${st.todayList.map((b) => `<div class="tl"><div class="tl-time">${esc(timeLabel(b.start))}<small>${dur(b.duration)}</small></div>${bookingRow(b)}</div>`).join('')}</div>` : `<div class="empty-state"><div class="big">☕</div><p>${esc(T('nothingToday'))}</p></div>`}
          </div>
          <div class="grid2 gap">
            <div class="card">
              <h3>${ic('trend-up')}${esc(T('busiestDays'))}</h3>
              <div class="wk-bars">${st.weekdays.map((v, i) => `<div class="${i === peakWd && v ? 'peak' : ''}"><i style="height:${(v / maxWd) * 100}%"></i>${esc(dayName(i, 'narrow'))}</div>`).join('')}</div>
            </div>
            <div class="card">
              <h3>${ic('star')}${esc(T('topServices'))}</h3>
              ${st.top.length ? `<ul class="top-list">${st.top.map((x, i) => `<li><span class="rank">${i + 1}</span><span class="nm">${esc(x.emoji)} ${esc(x.name)}<i style="width:${(x.count / maxTop) * 100}%"></i></span><b>${x.count}</b></li>`).join('')}</ul>` : `<p class="muted">${esc(T('noData'))}</p>`}
            </div>
          </div>
        </div>
        <div>
          <div class="card">
            <h3>${ic('bell')}${esc(T('remindersDue'))}</h3>
            <p class="muted small" style="margin-top:-8px">${esc(T('remindersHint'))}</p>
            ${st.remind.length ? st.remind.map((b) => `<div class="remind-row"><div class="bd"><b>${esc(b.customer.name)}</b><span>${esc(timeLabel(b.start))} · ${esc(b.serviceName)}${b.staffName ? ` · ${esc(b.staffName)}` : ''}</span></div>${b.customer.phone ? `<button class="btn sm ${b.reminded ? 'done' : 'wa'}" data-remind="${b.id}" type="button">${ic(b.reminded ? 'check' : 'whatsapp')}${esc(b.reminded ? T('reminded') : T('remind'))}</button>` : ''}</div>`).join('') : `<p class="muted">${esc(T('noReminders'))}</p>`}
          </div>
          ${allDone ? '' : `<div class="card"><h3>${ic('rocket')}${esc(T('getStarted'))}</h3><div class="progress"><i style="width:${(steps.filter((x) => x[0]).length / steps.length) * 100}%"></i></div><ul class="checklist">${steps.map(([done, label, tab]) => `<li class="${done ? 'done' : ''}"><span class="tick">${done ? ic('check') : ''}</span>${done ? esc(label) : `<a href="#${tab}" data-tab="${tab}">${esc(label)}</a>`}</li>`).join('')}</ul></div>`}
          <div class="card">
            <h3>${ic('link')}${esc(T('yourLink'))}</h3>
            <div class="share-row"><input class="input" readonly value="${esc(link)}"><button class="btn sm" data-act="copy" data-text="${esc(link)}" type="button">${ic('copy')}</button></div>
            <div class="qr-mini"><img src="/api/admin/qr.svg?text=${encodeURIComponent(link)}" alt="QR" width="150" height="150"></div>
          </div>
        </div>
      </div>`;
    view.onclick = async (e) => {
      const rem = e.target.closest('[data-remind]');
      const st2 = e.target.closest('[data-status]');
      const dep = e.target.closest('[data-deposit]');
      if (dep) {
        e.stopPropagation();
        await api('PUT', `/api/admin/bookings/${dep.dataset.deposit}`, { depositPaid: true });
        toast(T('saved'));
        return renderTab();
      }
      if (rem) {
        await openWhatsApp(rem.dataset.remind, 'reminder');
        rem.className = 'btn sm done';
        rem.innerHTML = `${ic('check')}${esc(T('reminded'))}`;
      } else if (st2) {
        e.stopPropagation();
        await setStatus(st2.dataset.id, st2.dataset.status);
        renderTab();
      } else if (e.target.closest('[data-open]')) bookingModal(e.target.closest('[data-open]').dataset.open);
    };
  };

  // ======================= CALENDAR =======================
  VIEWS.calendar = async (view) => {
    if (!state.weekStart) state.weekStart = addDays(today(), -dow(today()));
    const from = state.weekStart;
    const to = addDays(from, 6);
    const { bookings } = await api('GET', `/api/admin/bookings?from=${from}&to=${to}`);
    const s = state.data.settings;
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const weekHours = [s.hours, ...state.data.staff.map((m) => m.hours).filter(Boolean)];
    let startH = 24;
    let endH = 0;
    for (const w of weekHours) {
      for (const d of w) {
        if (!d.open) continue;
        startH = Math.min(startH, Math.floor(toMin(d.from) / 60));
        const e = toMin(d.to) <= toMin(d.from) ? 24 : Math.ceil(toMin(d.to) / 60);
        endH = Math.max(endH, e);
      }
    }
    for (const b of bookings) {
      startH = Math.min(startH, Math.floor(b.start / 60));
      endH = Math.max(endH, Math.ceil(b.end / 60));
    }
    if (startH >= endH) { startH = 8; endH = 20; }
    const HPX = 56;
    const height = (endH - startH) * HPX;
    const y = (min) => ((min - startH * 60) / 60) * HPX;
    const visible = bookings.filter((b) => b.status !== 'cancelled' && (!state.calStaff || b.staffId === state.calStaff));
    const blocks = state.data.blocks.filter((k) => k.date >= from && k.date <= to && (!state.calStaff || !k.staffId || k.staffId === state.calStaff));

    // Side-by-side lanes for overlapping bookings on the same day.
    const lanesFor = (list) => {
      const sorted = [...list].sort((a, b) => a.start - b.start);
      const lanes = [];
      for (const b of sorted) {
        let lane = lanes.findIndex((end) => end <= b.start);
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = b.end;
        b._lane = lane;
      }
      for (const b of sorted) b._lanes = lanes.length;
      return sorted;
    };

    const range = `${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('calendar'))}</h2></div>
      <div class="cal-head">
        <button class="icon-btn" data-week="-7" title="${esc(T('prevWeek'))}">${ic('chevron-left', 'i flip-rtl')}</button>
        <button class="btn sm line" data-week="0">${esc(T('today'))}</button>
        <button class="icon-btn" data-week="7" title="${esc(T('nextWeek'))}">${ic('chevron', 'i flip-rtl')}</button>
        <span class="range">${esc(range)}</span>
        <span class="grow"></span>
        ${state.data.staff.length ? `<select id="cal-staff"><option value="">${esc(T('everyone'))}</option>${state.data.staff.map((m) => `<option value="${m.id}" ${m.id === state.calStaff ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}
        <button class="btn sm" data-act="new">${ic('calendar-plus')}<span class="hide-sm">${esc(T('newBooking'))}</span></button>
      </div>
      <div class="cal-wrap"><div class="cal">
        <div class="cal-dh"></div>
        ${days.map((d) => `<div class="cal-dh${d === today() ? ' today' : ''}">${esc(fmtDate(d, { weekday: 'short' }))}<b>${esc(fmtDate(d, { day: 'numeric' }))}</b></div>`).join('')}
        <div class="cal-hours" style="height:${height}px">${Array.from({ length: endH - startH }, (_, i) => `<span style="top:${i * HPX}px">${hhmm((startH + i) * 60)}</span>`).join('')}</div>
        ${days.map((d) => {
          const wd = s.hours[dow(d)];
          const closed = !wd || !wd.open;
          const evs = lanesFor(visible.filter((b) => b.date === d));
          const nowLine = d === today() && state.data.now.minutes >= startH * 60 && state.data.now.minutes <= endH * 60 ? `<div class="now-line" style="top:${y(state.data.now.minutes)}px"></div>` : '';
          return `<div class="cal-col${closed ? ' closed' : ''}" data-day="${d}" style="height:${height}px">
            ${Array.from({ length: endH - startH }, (_, i) => `<div class="hl" style="top:${i * HPX}px"></div>`).join('')}
            ${blocks.filter((k) => k.date === d).map((k) => `<div class="ev blk" style="top:${y(Math.max(k.from, startH * 60))}px;height:${Math.max(18, y(Math.min(k.to, endH * 60)) - y(Math.max(k.from, startH * 60)))}px;inset-inline:2px"><b>${ic('plane', 'i xs')} ${esc(k.note || T('timeOff'))}</b><span>${esc(k.staffId ? (staffById(k.staffId) || {}).name || '' : T('wholeTeam'))}</span></div>`).join('')}
            ${evs.map((b) => {
              const w = 100 / b._lanes;
              return `<div class="ev ${b.status}" data-open="${b.id}" style="--h:${staffHue(b.staffId)};top:${y(b.start)}px;height:${Math.max(22, y(b.end) - y(b.start) - 2)}px;inset-inline-start:calc(${b._lane * w}% + 2px);width:calc(${w}% - 4px)"><b>${esc(b.emoji)} ${esc(b.customer.name)}</b><span>${esc(timeLabel(b.start))} · ${esc(b.serviceName)}</span></div>`;
            }).join('')}
            ${nowLine}
          </div>`;
        }).join('')}
      </div></div>
      ${state.data.staff.length ? `<div class="legend-staff">${state.data.staff.map((m) => `<span><i style="--h:${hue(m.name)}"></i>${esc(m.name)}</span>`).join('')}</div>` : ''}`;

    view.onclick = (e) => {
      const wk = e.target.closest('[data-week]');
      const ev = e.target.closest('[data-open]');
      const col = e.target.closest('.cal-col');
      if (wk) {
        const n = Number(wk.dataset.week);
        state.weekStart = n ? addDays(state.weekStart, n) : addDays(today(), -dow(today()));
        return renderTab();
      }
      if (ev) return bookingModal(ev.dataset.open);
      if (col && !e.target.closest('.ev')) {
        const rect = col.getBoundingClientRect();
        const min = startH * 60 + Math.floor(((e.clientY - rect.top) / HPX) * 60 / 15) * 15;
        newBookingModal({ date: col.dataset.day, start: Math.round(min / (Number(s.slotStep) || 30)) * (Number(s.slotStep) || 30), staffId: state.calStaff });
      }
    };
    const sel = $('#cal-staff', view);
    if (sel) sel.addEventListener('change', () => { state.calStaff = sel.value; renderTab(); });
    // Scroll so "now" (or opening time) is visible.
    const wrap = $('.cal-wrap', view);
    if (wrap && days.includes(today())) {
      const col = $(`.cal-col[data-day="${today()}"]`, view);
      if (col) wrap.scrollLeft = Math.max(0, col.offsetLeft - 80) * (T('dir') === 'rtl' ? -1 : 1);
    }
  };

  // ======================= BOOKINGS =======================
  VIEWS.bookings = async (view) => {
    const f = state.listFilter;
    const qs = new URLSearchParams();
    if (f === 'upcoming') qs.set('from', today());
    else if (f !== 'all') { qs.set('status', f); qs.set('order', 'desc'); }
    else qs.set('order', 'desc');
    if (state.q) qs.set('q', state.q);
    const { bookings } = await api('GET', `/api/admin/bookings?${qs}`);
    const list = f === 'upcoming' ? bookings.filter((b) => ['pending', 'confirmed'].includes(b.status)) : bookings;
    setPendingDot(list.filter((b) => b.status === 'pending').length || undefined);
    const filters = ['upcoming', 'pending', 'confirmed', 'completed', 'noshow', 'cancelled', 'all'];
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('bookings'))}</h2><button class="btn" data-act="new" style="margin-inline-start:auto">${ic('calendar-plus')}${esc(T('newBooking'))}</button></div>
      <div class="filters">${filters.map((k) => `<button type="button" data-filter="${k}" class="${k === f ? 'active' : ''}">${esc(k === 'upcoming' ? T('upcomingFilter') : k === 'all' ? T('all') : T(`st_${k}`))}</button>`).join('')}</div>
      <div class="card" style="padding:10px 16px">
        <div class="field" style="margin:6px 0 10px"><input class="input" id="q" placeholder="${esc(T('searchBookings'))}" value="${esc(state.q)}"></div>
        ${list.length ? `<div class="row-list">${list.map((b) => `<div class="list-row" data-open="${b.id}"><div class="when"><b>${esc(timeLabel(b.start))}</b>${esc(fmtDate(b.date))}</div><span class="avatar" style="--h:${hue(b.serviceName)};width:40px;height:40px;border-radius:12px;font-size:20px">${esc(b.emoji || '✨')}</span><div class="bd"><b>${esc(b.customer.name)}</b><span>${esc(b.serviceName)}${b.staffName ? ` · ${esc(b.staffName)}` : ''}${b.customer.phone ? ` · ${esc(b.customer.phone)}` : ''}</span></div>${statusChip(b.status)}</div>`).join('')}</div>` : `<div class="empty-state"><div class="big">📭</div><p>${esc(T('noBookings'))}</p></div>`}
      </div>`;
    view.onclick = (e) => {
      const fb = e.target.closest('[data-filter]');
      const row = e.target.closest('[data-open]');
      if (fb) { state.listFilter = fb.dataset.filter; renderTab(); } else if (row) bookingModal(row.dataset.open);
    };
    let tmr;
    $('#q', view).addEventListener('input', (e) => {
      clearTimeout(tmr);
      tmr = setTimeout(async () => {
        state.q = e.target.value.trim();
        await renderTab();
        const q = $('#q');
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }, 300);
    });
  };

  // ======================= SERVICES =======================
  const DURATIONS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
  const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60];

  VIEWS.services = async (view) => {
    const { services, staff } = state.data;
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('services'))}</h2><button class="btn" data-svc="" style="margin-inline-start:auto">${ic('plus')}${esc(T('addService'))}</button></div>
      <div class="card">${services.length ? services.map((x, i) => `<div class="svc-row ${x.active === false ? 'off' : ''}">
        <span class="em" style="--h:${hue(x.name)}">${esc(x.emoji || x.name.charAt(0))}</span>
        <div class="bd">${esc(x.name)}<span>${dur(x.duration)}${x.buffer ? ` + ${x.buffer}m` : ''} · ${x.price ? esc(money(x.price)) : '—'}${staff.length ? ` · ${x.staffIds.length ? x.staffIds.map((id) => esc((staffById(id) || {}).name || '')).join(', ') : esc(T('everyone'))}` : ''}</span></div>
        <button class="icon-btn" data-move="${x.id}" ${i === 0 ? 'disabled' : ''} title="↑">${ic('arrow-up')}</button>
        <button class="icon-btn" data-svc="${x.id}" title="${esc(T('edit'))}">${ic('edit')}</button>
      </div>`).join('') : `<div class="empty-state"><div class="big">✂️</div><p>${esc(T('noServicesYet'))}</p></div>`}</div>`;
    view.onclick = async (e) => {
      const ed = e.target.closest('[data-svc]');
      const mv = e.target.closest('[data-move]');
      if (ed) serviceModal(serviceById(ed.dataset.svc));
      else if (mv) {
        const ids = services.map((x) => x.id);
        const i = ids.indexOf(mv.dataset.move);
        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
        await api('POST', '/api/admin/reorder', { collection: 'services', ids });
        await loadData();
        renderTab();
      }
    };
  };

  function serviceModal(x) {
    const isNew = !x;
    x = x || { name: '', description: '', emoji: '✨', duration: 30, buffer: 0, price: '', active: true, staffIds: [] };
    const box = openModal(`
      <h3>${esc(isNew ? T('addService') : T('editService'))}</h3>
      <form id="sf">
        <div style="display:grid;grid-template-columns:90px 1fr;gap:12px">
          <label class="field"><span>${esc(T('emoji'))}</span><input name="emoji" maxlength="8" value="${esc(x.emoji)}" style="text-align:center;font-size:22px"></label>
          <label class="field"><span>${esc(T('name'))} *</span><input name="name" maxlength="100" required value="${esc(x.name)}"></label>
        </div>
        <label class="field"><span>${esc(T('description'))}</span><input name="description" maxlength="400" value="${esc(x.description)}"></label>
        <div class="grid3">
          <label class="field"><span>${esc(T('duration'))}</span><select name="duration">${[...new Set([...DURATIONS, x.duration])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === x.duration ? 'selected' : ''}>${dur(m)}</option>`).join('')}</select></label>
          <label class="field"><span>${esc(T('price'))}</span><input name="price" type="number" min="0" step="any" value="${esc(x.price)}"><small>${esc(T('priceHint'))}</small></label>
          <label class="field"><span>${esc(T('buffer'))}</span><select name="buffer">${[...new Set([...BUFFERS, x.buffer])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === x.buffer ? 'selected' : ''}>${m ? dur(m) : '—'}</option>`).join('')}</select><small>${esc(T('bufferHint'))}</small></label>
        </div>
        ${state.data.staff.length ? `<div class="field"><span>${esc(T('whoCanDo'))}</span><div class="checks">${state.data.staff.map((m) => `<label><input type="checkbox" name="staff" value="${m.id}" ${x.staffIds.includes(m.id) ? 'checked' : ''} hidden>${esc(m.name)}</label>`).join('')}</div><small>${esc(T('whoCanDoHint'))}</small></div>` : ''}
        ${sw('active', x.active !== false, esc(T('active')))}
        <div class="modal-actions">
          <button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          ${isNew ? '' : `<button class="btn danger" type="button" id="del">${ic('trash')}${esc(T('del'))}</button>`}
          <button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button>
        </div>
      </form>`);
    const f = $('#sf', box);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: f.name.value, emoji: f.emoji.value, description: f.description.value, duration: Number(f.duration.value),
        price: f.price.value, buffer: Number(f.buffer.value), active: f.active.checked,
        staffIds: $$('input[name=staff]:checked', f).map((c) => c.value),
      };
      try {
        await api(isNew ? 'POST' : 'PUT', isNew ? '/api/admin/services' : `/api/admin/services/${x.id}`, body);
        await loadData();
        closeModal();
        toast(T('saved'));
        renderTab();
      } catch {
        toast(T('error'), true);
      }
    });
    const del = $('#del', box);
    if (del) del.addEventListener('click', async () => {
      if (!confirm(T('confirmDelete'))) return;
      await api('DELETE', `/api/admin/services/${x.id}`);
      await loadData();
      closeModal();
      renderTab();
    });
    f.name.focus();
  }

  // ======================= TEAM =======================
  const weekEditor = (week, prefix) => `<div class="sched-grid">${week.map((d, i) => `<div class="sched-row" data-${prefix}="${i}">
      <span class="sched-day">${esc(dayName(i))}</span>
      <label class="switch"><input type="checkbox" data-open ${d.open ? 'checked' : ''}><i></i></label>
      <input type="time" class="input" data-from value="${esc(d.from)}" ${d.open ? '' : 'disabled'}>
      <span class="muted">→</span>
      <input type="time" class="input" data-to value="${esc(d.to)}" ${d.open ? '' : 'disabled'}>
    </div>`).join('')}</div>`;
  const readWeek = (root, prefix) => $$(`[data-${prefix}]`, root).map((r) => ({ open: $('[data-open]', r).checked, from: $('[data-from]', r).value, to: $('[data-to]', r).value }));
  const wireWeek = (root) => root.addEventListener('change', (e) => {
    if (e.target.matches('[data-open]')) $$('input[type=time]', e.target.closest('.sched-row')).forEach((i) => (i.disabled = !e.target.checked));
  });

  VIEWS.team = async (view) => {
    const { staff, blocks } = state.data;
    const upcomingBlocks = blocks.filter((k) => k.date >= today());
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('team'))}</h2><button class="btn" data-member="" style="margin-inline-start:auto">${ic('plus')}${esc(T('addMember'))}</button></div>
      <div class="card">${staff.length ? staff.map((m, i) => `<div class="staff-row ${m.active === false ? 'off' : ''}">
          <span class="avatar" style="--h:${hue(m.name)}">${m.photo ? `<img src="${esc(m.photo)}" alt="">` : esc(m.name.charAt(0))}</span>
          <div class="bd">${esc(m.name)}<span>${esc(m.title || '')}${m.hours ? ` · ${ic('clock', 'i xs')}` : ''}</span></div>
          <button class="icon-btn" data-move="${m.id}" ${i === 0 ? 'disabled' : ''}>${ic('arrow-up')}</button>
          <button class="icon-btn" data-member="${m.id}" title="${esc(T('edit'))}">${ic('edit')}</button>
        </div>`).join('') : `<div class="empty-state"><div class="big">🧑‍🤝‍🧑</div><p>${esc(T('noTeamYet'))}</p></div>`}</div>
      <div class="card">
        <h3>${ic('plane')}${esc(T('timeOff'))}</h3>
        ${upcomingBlocks.length ? upcomingBlocks.map((k) => `<div class="block-row"><div class="bd"><b>${esc(fmtDate(k.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</b><span>${k.allDay ? esc(T('allDay')) : `${esc(timeLabel(k.from))} – ${esc(timeLabel(k.to % 1440))}`} · ${esc(k.staffId ? (staffById(k.staffId) || {}).name || '' : T('wholeTeam'))}${k.note ? ` · ${esc(k.note)}` : ''}</span></div><button class="icon-btn danger" data-delblock="${k.id}">${ic('trash')}</button></div>`).join('') : `<p class="muted">${esc(T('noTimeOff'))}</p>`}
        <form id="bf" class="card" style="padding:12px;margin:12px 0 0;background:var(--surface-2);border:0">
          <div class="grid2">
            <label class="field"><span>${esc(T('date'))}</span><input name="date" type="date" value="${esc(today())}" required></label>
            <label class="field"><span>${esc(T('staff'))}</span><select name="staffId"><option value="">${esc(T('wholeTeam'))}</option>${staff.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
          </div>
          ${sw('allDay', true, esc(T('allDay')))}
          <div class="grid3" id="bf-times" hidden>
            <label class="field"><span>${esc(T('from'))}</span><input name="from" type="time" value="12:00"></label>
            <label class="field"><span>${esc(T('to'))}</span><input name="to" type="time" value="14:00"></label>
            <label class="field"><span>${esc(T('notes'))}</span><input name="note" maxlength="100"></label>
          </div>
          <button class="btn sm" type="submit">${ic('plus')}${esc(T('addTimeOff'))}</button>
        </form>
      </div>`;
    const bf = $('#bf', view);
    bf.allDay.addEventListener('change', () => ($('#bf-times', view).hidden = bf.allDay.checked));
    bf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/admin/blocks', { date: bf.date.value, staffId: bf.staffId.value, allDay: bf.allDay.checked, from: bf.from.value, to: bf.to.value, note: bf.note.value });
        await loadData();
        toast(T('saved'));
        renderTab();
      } catch {
        toast(T('error'), true);
      }
    });
    view.onclick = async (e) => {
      const ed = e.target.closest('[data-member]');
      const mv = e.target.closest('[data-move]');
      const db = e.target.closest('[data-delblock]');
      if (ed) memberModal(staffById(ed.dataset.member));
      else if (db) {
        await api('DELETE', `/api/admin/blocks/${db.dataset.delblock}`);
        await loadData();
        renderTab();
      } else if (mv) {
        const ids = staff.map((x) => x.id);
        const i = ids.indexOf(mv.dataset.move);
        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
        await api('POST', '/api/admin/reorder', { collection: 'staff', ids });
        await loadData();
        renderTab();
      }
    };
  };

  function memberModal(m) {
    const isNew = !m;
    m = m || { name: '', title: '', photo: '', active: true, hours: null };
    let photo = m.photo;
    const week = m.hours || state.data.settings.hours;
    const box = openModal(`
      <h3>${esc(isNew ? T('addMember') : T('editMember'))}</h3>
      <form id="mf">
        <div class="img-pick" style="margin-bottom:14px"><div class="preview" id="mp" style="border-radius:50%"></div>
          <div style="display:grid;gap:6px"><label class="btn sm line" style="cursor:pointer">${ic('upload')}${esc(T('uploadImage'))}<input type="file" accept="image/*" id="mfile" hidden></label><button type="button" class="btn sm ghost" id="mrm">${ic('trash')}${esc(T('removeImage'))}</button></div></div>
        <div class="grid2">
          <label class="field"><span>${esc(T('name'))} *</span><input name="name" maxlength="60" required value="${esc(m.name)}"></label>
          <label class="field"><span>${esc(T('memberTitle'))}</span><input name="title" maxlength="60" value="${esc(m.title)}" placeholder="${esc(T('memberTitlePh'))}"></label>
        </div>
        ${sw('active', m.active !== false, esc(T('active')))}
        ${sw('own', !!m.hours, `${esc(T('ownHours'))} <small class="muted">— ${esc(T('ownHoursHint'))}</small>`)}
        <div id="mweek" ${m.hours ? '' : 'hidden'}>${weekEditor(week, 'md')}</div>
        <div class="modal-actions" style="margin-top:14px">
          <button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          ${isNew ? '' : `<button class="btn danger" type="button" id="del">${ic('trash')}${esc(T('del'))}</button>`}
          <button class="btn ghost" type="button" data-close>${esc(T('cancel'))}</button>
        </div>
      </form>`);
    const f = $('#mf', box);
    const showPhoto = () => {
      $('#mp', box).innerHTML = photo ? `<img src="${esc(photo)}" alt="">` : ic('user');
      $('#mrm', box).hidden = !photo;
    };
    showPhoto();
    wireWeek($('#mweek', box));
    f.own.addEventListener('change', () => ($('#mweek', box).hidden = !f.own.checked));
    $('#mfile', box).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { photo = await uploadFile(file, 400); showPhoto(); } catch { toast(T('tooLarge'), true); }
    });
    $('#mrm', box).addEventListener('click', () => { photo = ''; showPhoto(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, title: f.title.value, photo, active: f.active.checked, hours: f.own.checked ? readWeek(box, 'md') : null };
      try {
        await api(isNew ? 'POST' : 'PUT', isNew ? '/api/admin/staff' : `/api/admin/staff/${m.id}`, body);
        await loadData();
        closeModal();
        toast(T('saved'));
        renderTab();
      } catch {
        toast(T('error'), true);
      }
    });
    const del = $('#del', box);
    if (del) del.addEventListener('click', async () => {
      if (!confirm(T('confirmDelete'))) return;
      await api('DELETE', `/api/admin/staff/${m.id}`);
      await loadData();
      closeModal();
      renderTab();
    });
  }

  // ======================= DESIGN =======================
  const COLORS = ['#7c3aed', '#db2777', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0f766e', '#0284c7', '#2563eb', '#111827'];
  const themeMini = (th) => `<div class="tp tp-${th}" aria-hidden="true"><i class="h"></i><div class="rows"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i></div></div>`;
  function loadFontCss(fonts) {
    for (const f of fonts) {
      if ($(`link[data-font-css="${f.key}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = f.href;
      l.dataset.fontCss = f.key;
      document.head.appendChild(l);
    }
  }

  VIEWS.appearance = async (view) => {
    const s = state.data.settings;
    const opts = state.data.appearance;
    const draft = { theme: s.theme || 'fresh', color: s.color, font: s.font || 'cairo', logo: s.logo, cover: s.cover };
    const KEYS = Object.keys(draft);
    loadFontCss(opts.fonts);
    const imgPick = (key, wide) => `<div class="img-pick"><div class="preview${wide ? ' wide' : ''}" id="${key}-prev"></div><div style="display:grid;gap:6px"><label class="btn sm line" style="cursor:pointer">${ic('upload')}${esc(T('uploadImage'))}<input type="file" accept="image/*" id="${key}-file" hidden></label><button type="button" class="btn sm ghost" id="${key}-rm">${ic('trash')}${esc(T('removeImage'))}</button></div></div>`;
    view.innerHTML = `
      <div class="page-head"><h2 class="title">${esc(T('appearance'))}</h2><span class="unsaved" id="unsaved" hidden><i></i>${esc(T('unsaved'))}</span></div>
      <div class="design">
        <div class="design-controls">
          <div class="card"><h3>${ic('sparkles')}${esc(T('themeLabel'))}</h3>
            <div class="themes">${opts.themes.map((th) => `<button type="button" class="theme-card" data-theme="${th}">${themeMini(th)}<b>${esc(T(`theme_${th}`))}</b><span>${esc(T(`themeDesc_${th}`))}</span></button>`).join('')}</div></div>
          <div class="card"><h3>${ic('palette')}${esc(T('brandColor'))}</h3>
            <div class="swatches" id="swatches">${COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<label class="custom-color"><input type="color" id="color" value="${esc(draft.color)}"></label></div></div>
          <div class="card"><h3><span class="aa">Aa</span>${esc(T('font'))}</h3>
            <div class="fonts">${opts.fonts.map((f) => `<button type="button" class="font-card" data-font="${f.key}" style="font-family:${esc(f.stack)}"><span class="sample">Aa أب</span><small>${esc(f.label)}</small></button>`).join('')}</div></div>
          <div class="card"><h3>${ic('image')}${esc(T('logo'))} · ${esc(T('cover'))}</h3>
            <div class="grid2"><div class="field"><span>${esc(T('logo'))}</span>${imgPick('logo')}</div><div class="field"><span>${esc(T('cover'))}</span>${imgPick('cover', true)}</div></div></div>
          <div class="save-bar"><button class="btn block" type="button" id="dsave">${ic('check')}${esc(T('save'))}</button></div>
        </div>
        <div class="design-preview">
          <div class="phone"><div class="notch"></div><iframe id="pv" src="/?preview=1&lang=${encodeURIComponent(s.lang)}" title="${esc(T('livePreview'))}"></iframe></div>
          <p class="muted small preview-hint">${ic('eye')}<span>${esc(T('previewHint'))}</span></p>
        </div>
      </div>`;
    const pv = $('#pv');
    const send = () => {
      const font = opts.fonts.find((f) => f.key === draft.font) || opts.fonts[0];
      if (pv.contentWindow) pv.contentWindow.postMessage({ type: 'mawid-preview', theme: draft.theme, color: draft.color, fontStack: font.stack, fontHref: font.href, logo: draft.logo, cover: draft.cover }, location.origin);
    };
    const sync = () => {
      $$('.theme-card', view).forEach((b) => b.classList.toggle('active', b.dataset.theme === draft.theme));
      $$('.font-card', view).forEach((b) => b.classList.toggle('active', b.dataset.font === draft.font));
      $$('#swatches [data-color]', view).forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === draft.color.toLowerCase()));
      $('#color').value = draft.color;
      view.style.setProperty('--c', draft.color);
      $('#logo-prev').innerHTML = draft.logo ? `<img src="${esc(draft.logo)}" alt="">` : ic('store');
      $('#cover-prev').innerHTML = draft.cover ? `<img src="${esc(draft.cover)}" alt="">` : ic('image');
      $('#logo-rm').hidden = !draft.logo;
      $('#cover-rm').hidden = !draft.cover;
      $('#unsaved').hidden = !KEYS.some((k) => (draft[k] || '') !== (s[k] || ''));
      send();
    };
    pv.addEventListener('load', send);
    view.onclick = (e) => {
      const th = e.target.closest('[data-theme]');
      const fo = e.target.closest('[data-font]');
      const co = e.target.closest('[data-color]');
      if (th) draft.theme = th.dataset.theme;
      else if (fo) draft.font = fo.dataset.font;
      else if (co) draft.color = co.dataset.color;
      else return;
      sync();
    };
    $('#color').addEventListener('input', (e) => { draft.color = e.target.value; sync(); });
    for (const [key, max] of [['logo', 512], ['cover', 1600]]) {
      $(`#${key}-file`).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { draft[key] = await uploadFile(f, max); sync(); } catch { toast(T('tooLarge'), true); }
      });
      $(`#${key}-rm`).addEventListener('click', () => { draft[key] = ''; sync(); });
    }
    $('#dsave').addEventListener('click', async () => {
      try {
        const { settings } = await api('PUT', '/api/admin/settings', draft);
        state.data.settings = settings;
        document.documentElement.style.setProperty('--brand', settings.color);
        toast(T('saved'));
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    sync();
  };

  // ======================= SHARE =======================
  VIEWS.share = async (view) => {
    const s = state.data.settings;
    const link = state.data.baseUrl;
    const qr = `/api/admin/qr.svg?text=${encodeURIComponent(link)}`;
    const text = `${T('shareText').replace('{name}', s.name)}\n${link}`;
    view.innerHTML = `
      <h2 class="title">${esc(T('shareTitle'))}</h2>
      <div class="card"><div class="qr-box"><img src="${qr}" alt="QR"><div>
        <p class="muted">${esc(T('shareSub'))}</p>
        <div class="share-row" style="margin-bottom:10px"><input class="input" readonly value="${esc(link)}"><button class="btn sm" data-act="copy" data-text="${esc(link)}">${ic('copy')}${esc(T('copy'))}</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn line sm" href="${qr}" download="qr-${esc(s.name)}.svg">${ic('download')}${esc(T('downloadQr'))}</a>
          <a class="btn line sm" href="/admin/poster" target="_blank">${ic('print')}${esc(T('printPoster'))}</a>
          <a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(T('shareWhatsApp'))}</a>
        </div></div></div></div>
      <div class="card"><h3>${ic('bulb')}${esc(T('tipsTitle'))}</h3><ul class="checklist">${['tip1', 'tip2', 'tip3', 'tip4'].map((k) => `<li><span class="tick">${ic('sparkles')}</span>${esc(T(k))}</li>`).join('')}</ul></div>`;
  };

  // ======================= SETTINGS =======================
  // ---- Telegram notifications card (Settings) ----
  async function renderNotify(box) {
    const n = await api('GET', '/api/admin/notify');
    box.innerHTML = `
      <h3>${ic('bell')}${esc(T('notifications'))}${n.connected ? `<span class="ok-chip">${ic('check')}${esc(T('notifyConnected'))}</span>` : ''}</h3>
      <p class="muted small" style="margin-top:-6px">${esc(T('notifyHint'))}</p>
      <ol class="steps-list"><li>${esc(T('notifyStep1'))}</li><li>${esc(T('notifyStep2'))}</li><li>${esc(T('notifyStep3'))}</li></ol>
      <form id="nf">
        <label class="field"><span>${esc(T('botToken'))}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…" dir="ltr">${n.hasToken ? `<small>${esc(T('tokenSaved').replace('{hint}', n.tokenHint))}</small>` : ''}</label>
        <div class="share-row" style="align-items:flex-end">
          <label class="field" style="flex:1;margin:0"><span>${esc(T('chatId'))}</span><input name="chat" value="${esc(n.telegramChat)}" dir="ltr"></label>
          <button class="btn line" type="button" id="ndetect">${ic('search')}${esc(T('detectChat'))}</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn" type="submit">${ic('check')}${esc(T('save'))}</button>
          <button class="btn line" type="button" id="ntest" ${n.connected ? '' : 'disabled'}>${ic('bell')}${esc(T('sendTest'))}</button>
          ${n.hasToken ? `<button class="btn danger" type="button" id="nclear">${esc(T('disconnect'))}</button>` : ''}
        </div>
      </form>`;
    const f = $('#nf', box);
    const fail = (err, fallback) => toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'invalid_token' ? T('invalidToken') : T(fallback), true);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/notify', { telegramToken: f.token.value, telegramChat: f.chat.value });
        toast(T('saved'));
        renderNotify(box);
      } catch (err) { fail(err, 'error'); }
    });
    $('#ndetect', box).addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/admin/notify/detect', { telegramToken: f.token.value });
        if (!r.chats.length) return toast(T('chatNotFound'), true);
        f.chat.value = r.chats[0].id;
        toast(`${T('chatFound')} ${r.chats[0].name}`);
      } catch (err) { fail(err, 'chatNotFound'); }
    });
    $('#ntest', box).addEventListener('click', async () => {
      try {
        await api('POST', '/api/admin/notify/test', { text: T('testMessage') });
        toast(T('testSent'));
      } catch (err) { fail(err, 'testFailed'); }
    });
    const clear = $('#nclear', box);
    if (clear) clear.addEventListener('click', async () => {
      try { await api('PUT', '/api/admin/notify', { clear: true }); renderNotify(box); } catch (err) { fail(err, 'error'); }
    });
  }

  VIEWS.settings = async (view) => {
    const s = state.data.settings;
    const sel = (name, values, current, label) => `<select name="${name}">${values.map((v) => `<option value="${v}" ${Number(v) === Number(current) ? 'selected' : ''}>${label(v)}</option>`).join('')}</select>`;
    view.innerHTML = `
      <h2 class="title">${esc(T('settings'))}</h2>
      <form id="sf">
        <div class="card"><h3>${ic('store')}${esc(T('business'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('businessName'))}</span><input name="name" maxlength="80" value="${esc(s.name)}"></label>
            <label class="field"><span>${esc(T('defaultLang'))}</span><select name="lang">${langOptions(s.lang)}</select></label>
          </div>
          <label class="field"><span>${esc(T('tagline'))}</span><input name="tagline" maxlength="140" value="${esc(s.tagline)}"></label>
          <label class="field"><span>${esc(T('about'))}</span><textarea name="about" rows="2" maxlength="1000">${esc(s.about)}</textarea></label>
          <div class="grid2">
            <label class="field"><span>${esc(T('whatsapp'))}</span><input name="whatsapp" type="tel" maxlength="20" value="${esc(s.whatsapp)}"><small>${esc(T('whatsappHint'))}</small></label>
            <label class="field"><span>${esc(T('currency'))}</span><input name="currency" maxlength="12" value="${esc(s.currency)}"></label>
          </div>
        </div>
        <div class="card"><h3>${ic('calendar')}${esc(T('bookingRules'))}</h3>
          ${sw('acceptingBookings', s.acceptingBookings, esc(T('acceptingBookings')))}
          ${sw('autoConfirm', s.autoConfirm, `${esc(T('autoConfirm'))} <small class="muted">— ${esc(T('autoConfirmHint'))}</small>`)}
          <div class="grid2">
            <label class="field"><span>${esc(T('slotStep'))}</span>${sel('slotStep', [10, 15, 20, 30, 45, 60], s.slotStep, (v) => `${v} ${T('unitMin')}`)}</label>
            <label class="field"><span>${esc(T('minNotice'))}</span>${sel('minNotice', [0, 15, 30, 60, 120, 180, 240, 720, 1440, 2880], s.minNotice, (v) => (v < 60 ? `${v} ${T('unitMin')}` : `${v / 60} ${T('unitHr')}`))}</label>
            <label class="field"><span>${esc(T('maxDays'))}</span><div class="unit"><input name="maxDays" type="number" min="1" max="365" value="${esc(s.maxDays)}"><span>${esc(T('unitDays'))}</span></div></label>
            <label class="field"><span>${esc(T('cancelHours'))}</span><div class="unit"><input name="cancelHours" type="number" min="0" max="168" value="${esc(s.cancelHours)}"><span>${esc(T('unitBefore'))}</span></div></label>
          </div>
          <label class="field"><span>${esc(T('policy'))}</span><textarea name="policy" rows="2" maxlength="600" placeholder="${esc(T('policyPh'))}">${esc(s.policy)}</textarea></label>
        </div>
        <div class="card"><h3>${ic('cash')}${esc(T('deposits'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('depositPercent'))}</span><div class="unit"><input name="depositPercent" type="number" min="0" max="100" value="${esc(s.depositPercent || 0)}"><span>%</span></div><small>${esc(T('depositPercentHint'))}</small></label>
            <label class="field"><span>${esc(T('paymentLink'))}</span><input name="paymentLink" type="url" maxlength="500" value="${esc(s.paymentLink || '')}" placeholder="https://…" dir="ltr"></label>
          </div>
          <label class="field"><span>${esc(T('paymentInfo'))}</span><textarea name="paymentInfo" rows="2" maxlength="300" placeholder="${esc(T('paymentInfoPh'))}">${esc(s.paymentInfo || '')}</textarea></label>
        </div>
        <div class="card"><h3>${ic('clock')}${esc(T('hoursTitle'))}</h3>
          <div id="hours">${weekEditor(s.hours, 'bh')}</div>
          <label class="field" style="margin-top:12px"><span>${esc(T('timezone'))}</span><input name="timezone" list="tzlist" value="${esc(s.timezone || browserTimezone())}"></label>
          <datalist id="tzlist">${timezones().map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
        </div>
        <div class="card"><h3>${ic('phone')}${esc(T('contact'))}</h3>
          <div class="grid2">
            <label class="field"><span>${esc(T('phone'))}</span><input name="phone" type="tel" maxlength="30" value="${esc(s.phone)}"></label>
            <label class="field"><span>${esc(T('address'))}</span><input name="address" maxlength="200" value="${esc(s.address)}"></label>
            <label class="field"><span>${esc(T('mapUrl'))}</span><input name="mapUrl" type="url" maxlength="500" value="${esc(s.mapUrl)}" placeholder="https://maps.app.goo.gl/…"></label>
            <label class="field"><span>Instagram</span><input name="instagram" maxlength="200" value="${esc(s.instagram)}" placeholder="@yourstudio"></label>
            <label class="field"><span>TikTok</span><input name="tiktok" maxlength="200" value="${esc(s.tiktok)}" placeholder="@yourstudio"></label>
            <label class="field"><span>Facebook</span><input name="facebook" maxlength="200" value="${esc(s.facebook)}"></label>
          </div>
        </div>
        <div class="save-bar" style="margin-bottom:16px"><button class="btn block" type="submit">${ic('check')}${esc(T('save'))}</button></div>
      </form>
      <div class="card" id="notify-card"></div>
      <div class="card"><h3>${ic('lock')}${esc(T('security'))}</h3>
        <form id="pw" class="grid2">
          <label class="field"><span>${esc(T('currentPassword'))}</span><input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${esc(T('newPassword'))}</span><input name="next" type="password" autocomplete="new-password" minlength="8" required></label>
          <div><button class="btn line" type="submit">${esc(T('changePassword'))}</button></div>
        </form></div>
      <div class="card"><h3>${ic('download')}${esc(T('backup'))}</h3><p class="muted small">${esc(T('backupHint'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn line" href="/api/admin/export" download>${ic('download')}${esc(T('exportData'))}</a>
        <label class="btn line" style="cursor:pointer">${ic('upload')}${esc(T('importData'))}<input type="file" accept="application/json,.json" id="imp" hidden></label></div></div>`;
    renderNotify($('#notify-card', view));
    const f = $('#sf', view);
    wireWeek($('#hours', view));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { hours: readWeek(view, 'bh') };
      for (const el of f.elements) {
        if (!el.name) continue;
        body[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      }
      try {
        const { settings } = await api('PUT', '/api/admin/settings', body);
        state.data.settings = settings;
        toast(T('saved'));
        await loadData();
        renderShell();
      } catch {
        toast(T('error'), true);
      }
    });
    $('#pw', view).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/admin/password', { current: e.target.current.value, next: e.target.next.value });
        e.target.reset();
        toast(T('passwordChanged'));
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : err.code === 'weak_password' ? T('weakPassword') : T('wrongPassword'), true);
      }
    });
    $('#imp', view).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !confirm(T('importConfirm'))) return;
      try {
        await api('POST', '/api/admin/import', JSON.parse(await file.text()));
        await loadData();
        toast(T('imported'));
        renderShell();
      } catch (err) {
        toast(err.code === 'demo' ? T('demoBlocked') : T('invalidBackup'), true);
      }
    });
  };

  // ======================= global events =======================
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-tab],[data-act]');
    if (!el) return;
    try {
      if (el.dataset.tab) {
        e.preventDefault();
        state.tab = el.dataset.tab;
        history.replaceState(null, '', `#${state.tab}`);
        renderTab();
        window.scrollTo(0, 0);
        return;
      }
      const act = el.dataset.act;
      if (act === 'logout') {
        await api('POST', '/api/logout');
        state.data = null;
        return boot();
      }
      if (act === 'copy') {
        await navigator.clipboard.writeText(el.dataset.text);
        return toast(T('copied'));
      }
      if (act === 'new') return newBookingModal();
    } catch (err) {
      if (err.message !== 'unauthorized') toast(T('error'), true);
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.dataset && e.target.dataset.actChange === 'lang') {
      await setLang(e.target.value);
      if (state.data) renderShell();
      else boot();
    }
  });
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (state.data && TABS.some(([k]) => k === h) && h !== state.tab) {
      state.tab = h;
      renderTab();
    }
  });

  // ======================= new-booking alerts =======================
  let pollTimer;
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((d) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.2, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + d);
        o.stop(ctx.currentTime + d + 0.16);
      });
    } catch { /* audio not allowed yet */ }
  }
  function startPolling() {
    clearInterval(pollTimer);
    const tick = async () => {
      if (!state.data) return;
      try {
        const st = await api('GET', '/api/admin/stats');
        setPendingDot(st.pending.length);
        if (state.latestNo !== null && st.latestNo > state.latestNo) {
          beep();
          toast(T('newBookingAlert'));
          if (['home', 'calendar', 'bookings'].includes(state.tab) && !$('#modal')) renderTab();
        }
        state.latestNo = st.latestNo;
      } catch { /* offline */ }
    };
    tick();
    pollTimer = setInterval(tick, 20000);
  }

  boot();
})();
