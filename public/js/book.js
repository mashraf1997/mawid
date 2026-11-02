(() => {
  'use strict';

  const D = window.MAWID;
  const t = D.t;
  const shop = D.shop;
  const services = new Map(D.services.map((s) => [s.id, s]));
  const staff = new Map(D.staff.map((m) => [m.id, m]));
  const CUSTOMER_KEY = 'mawid-customer';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${D.icons}#i-${name}"/></svg>`;
  const PREFIX = ['$', '€', '£', '¥', '₹', '₺', 'R$', 'US$', 'C$', 'A$'];
  const money = (n) => {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
    return PREFIX.includes(shop.currency) ? `${shop.currency}${s}` : `${s} ${shop.currency || ''}`.trim();
  };
  const dur = (m) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return !h ? `${r} ${t.min}` : r ? `${h} ${t.hr} ${r} ${t.min}` : `${h} ${t.hr}`;
  };
  const fmt = (date, opts) => new Intl.DateTimeFormat(D.lang, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = (min) => new Intl.DateTimeFormat(D.lang, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, Math.floor(min / 60), min % 60)));
  const addDays = (date, n) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const storage = {
    get(k, f) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Mawid': '1' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error });
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.innerHTML = `${ic('check')}<span>${esc(msg)}</span>`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---------------------------------------------------------------- state
  const state = { service: null, staffId: '', date: '', start: null, days: [], result: null };
  const STEPS = ['service', 'staff', 'time', 'details', 'done'];
  const eligibleStaff = () => {
    if (!state.service || !staff.size) return [];
    const ids = state.service.staffIds.length ? state.service.staffIds : [...staff.keys()];
    return ids.map((id) => staff.get(id)).filter(Boolean);
  };
  const needsStaffStep = () => eligibleStaff().length > 1;

  function show(step, push = true) {
    for (const s of STEPS) $(`#step-${s}`).hidden = s !== step;
    const idx = STEPS.indexOf(step);
    $$('#steps li').forEach((li, i) => {
      li.classList.toggle('on', i <= idx);
      li.classList.toggle('skip', li.dataset.step === 'staff' && !needsStaffStep());
    });
    $('#steps').hidden = step === 'done';
    if (push) history.pushState({ step }, '');
    renderBar(step);
    const top = $('#flow').getBoundingClientRect().top + scrollY - 12;
    if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
  }
  addEventListener('popstate', (e) => {
    const step = (e.state && e.state.step) || 'service';
    if (step === 'done' || (state.result && step !== 'service')) return show('service', false);
    show(step, false);
  });
  history.replaceState({ step: 'service' }, '');

  const header = (title) => `<h2><button type="button" class="back" data-back aria-label="${esc(t.back)}">${ic('arrow-left')}</button>${esc(title)}</h2>`;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) history.back();
  });

  // --------------------------------------------------------------- step 1
  function pickService(id) {
    state.service = services.get(id);
    if (!state.service) return;
    state.staffId = '';
    state.date = '';
    state.start = null;
    $$('.svc').forEach((b) => b.classList.toggle('sel', b.dataset.service === id));
    const people = eligibleStaff();
    if (people.length === 1) state.staffId = people[0].id;
    if (needsStaffStep()) renderStaff();
    else renderTime();
  }
  $('#step-service').addEventListener('click', (e) => {
    const b = e.target.closest('[data-service]');
    if (b) pickService(b.dataset.service);
  });

  // --------------------------------------------------------------- step 2
  function renderStaff() {
    const people = eligibleStaff();
    const el = $('#step-staff');
    el.innerHTML = `${header(t.chooseStaff)}
      <div class="people">
        <button type="button" class="person" data-staff=""><span class="avatar any">${ic('sparkles')}</span><b>${esc(t.anyone)}</b><small>${esc(t.anyoneHint)}</small></button>
        ${people.map((m) => `<button type="button" class="person" data-staff="${esc(m.id)}"><span class="avatar" style="--h:${m.hue}">${m.photo ? `<img src="${esc(m.photo)}" alt="">` : esc(m.name.charAt(0))}</span><b>${esc(m.name)}</b>${m.title ? `<small>${esc(m.title)}</small>` : ''}</button>`).join('')}
      </div>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-staff]');
      if (!b) return;
      state.staffId = b.dataset.staff;
      $$('.person', el).forEach((x) => x.classList.toggle('sel', x === b));
      renderTime();
    };
    show('staff');
  }

  // --------------------------------------------------------------- step 3
  async function renderTime() {
    const el = $('#step-time');
    el.innerHTML = `${header(t.chooseTime)}<div class="dates" id="dates">${'<div class="skeleton" style="width:64px;height:76px;flex:none"></div>'.repeat(6)}</div><div id="slots"></div>`;
    show('time');
    try {
      const q = `service=${encodeURIComponent(state.service.id)}&staff=${encodeURIComponent(state.staffId)}`;
      state.days = (await api('GET', `/api/days?${q}`)).days;
    } catch {
      state.days = [];
    }
    const first = state.days.find((d) => d.available);
    $('#dates', el).innerHTML = state.days
      .map((d) => {
        const label = d.date === D.today ? t.today : d.date === addDays(D.today, 1) ? t.tomorrow : fmt(d.date, { weekday: 'short' });
        return `<button type="button" class="date" data-date="${d.date}" ${d.available ? '' : 'disabled'}><small>${esc(label)}</small><b>${esc(fmt(d.date, { day: 'numeric' }))}</b><i>${esc(fmt(d.date, { month: 'short' }))}</i></button>`;
      })
      .join('');
    $('#dates', el).onclick = (e) => {
      const b = e.target.closest('[data-date]');
      if (b && !b.disabled) selectDate(b.dataset.date);
    };
    if (first) selectDate(state.date && state.days.some((d) => d.date === state.date && d.available) ? state.date : first.date);
    else $('#slots', el).innerHTML = `<p class="empty">${ic('calendar')}<br>${esc(t.noSlots)}</p>`;
  }

  async function selectDate(date) {
    state.date = date;
    state.start = null;
    renderBar('time');
    $$('#dates .date').forEach((b) => b.classList.toggle('sel', b.dataset.date === date));
    const sel = $(`#dates [data-date="${date}"]`);
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const box = $('#slots');
    box.innerHTML = `<div class="slots">${'<div class="skeleton"></div>'.repeat(8)}</div>`;
    let slots = [];
    try {
      slots = (await api('GET', `/api/slots?service=${encodeURIComponent(state.service.id)}&staff=${encodeURIComponent(state.staffId)}&date=${date}`)).slots;
    } catch { /* show none */ }
    if (state.date !== date) return;
    if (!slots.length) {
      box.innerHTML = `<p class="empty">${ic('calendar')}<br>${esc(t.noSlots)}</p>`;
      return;
    }
    const groups = [
      ['morning', 'sun', slots.filter((s) => s.start < 720)],
      ['afternoon', 'sunset', slots.filter((s) => s.start >= 720 && s.start < 1020)],
      ['evening', 'moon', slots.filter((s) => s.start >= 1020)],
    ].filter((g) => g[2].length);
    box.innerHTML = groups
      .map(([k, icon, list]) => `<div class="slot-group"><h3>${ic(icon)}${esc(t[k])}</h3><div class="slots">${list.map((s) => `<button type="button" class="slot" data-start="${s.start}">${esc(timeLabel(s.start))}</button>`).join('')}</div></div>`)
      .join('');
    box.onclick = (e) => {
      const b = e.target.closest('[data-start]');
      if (!b) return;
      state.start = Number(b.dataset.start);
      $$('.slot', box).forEach((x) => x.classList.toggle('sel', x === b));
      if (navigator.vibrate) navigator.vibrate(8);
      renderBar('time');
    };
  }

  function renderBar(step) {
    const bar = $('#bar');
    const ready = step === 'time' && state.start !== null;
    bar.hidden = !ready;
    if (!ready) return;
    const who = state.staffId && staff.get(state.staffId) ? ` · ${staff.get(state.staffId).name}` : '';
    $('#bar-sum').innerHTML = `<b>${esc(state.service.name)}${esc(who)}</b><span>${esc(fmt(state.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(timeLabel(state.start))}</span>`;
  }
  $('#bar-next').addEventListener('click', () => renderDetails());

  // --------------------------------------------------------------- step 4
  function summaryCard() {
    const s = state.service;
    const who = state.staffId && staff.get(state.staffId);
    return `<div class="summary-card">
      <div class="row"><span class="tile" style="--h:${s.hue}">${esc(s.emoji || s.name.charAt(0))}</span><div><b>${esc(s.name)}</b><span>${esc(dur(s.duration))}${s.price ? ` · ${esc(money(s.price))}` : ''}</span></div></div>
      <div class="row">${ic('calendar')}<div><span>${esc(t.when)}</span><b>${esc(fmt(state.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(timeLabel(state.start))}</b></div></div>
      ${who ? `<div class="row">${ic('user')}<div><span>${esc(t.with)}</span><b>${esc(who.name)}</b></div></div>` : ''}
    </div>`;
  }

  function renderDetails() {
    const saved = storage.get(CUSTOMER_KEY, {});
    const el = $('#step-details');
    el.innerHTML = `${header(t.yourDetails)}${summaryCard()}
      <form id="form" novalidate>
        <label class="field"><span>${esc(t.yourName)} *</span><input name="name" autocomplete="name" maxlength="80" value="${esc(saved.name || '')}" required></label>
        <label class="field"><span>${esc(t.yourPhone)} *</span><input name="phone" type="tel" autocomplete="tel" maxlength="30" value="${esc(saved.phone || '')}" required></label>
        <label class="field"><span>${esc(t.yourEmail)} <small class="muted">(${esc(t.optional)})</small></span><input name="email" type="email" autocomplete="email" maxlength="120" value="${esc(saved.email || '')}"><small class="muted">${esc(t.emailHint)}</small></label>
        <label class="field"><span>${esc(t.notes)}</span><textarea name="notes" rows="2" maxlength="500"></textarea></label>
        <button class="btn" type="submit" id="confirm" style="width:100%">${ic('check')}<span>${esc(t.confirmBooking)}</span></button>
        <p class="err" id="err" role="alert"></p>
        <p class="note">${ic('lock', 'i xs')} ${esc(t.rememberMe)}</p>
      </form>`;
    show('details');
    const form = $('#form', el);
    if (!form.name.value) form.name.focus({ preventScroll: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const err = $('#err', el);
      const missing = ['name', 'phone'].find((k) => !String(f[k] || '').trim());
      if (missing) {
        err.textContent = `${t.required}: ${missing === 'name' ? t.yourName : t.yourPhone}`;
        form[missing].focus();
        return;
      }
      const btn = $('#confirm', el);
      btn.disabled = true;
      $('span', btn).textContent = t.booking;
      try {
        state.result = await api('POST', '/api/bookings', {
          serviceId: state.service.id,
          staffId: state.staffId,
          date: state.date,
          start: state.start,
          customer: { name: f.name, phone: f.phone, email: f.email, notes: f.notes },
        });
        storage.set(CUSTOMER_KEY, { name: f.name, phone: f.phone, email: f.email || '' });
        renderDone();
      } catch (ex) {
        btn.disabled = false;
        $('span', btn).textContent = t.confirmBooking;
        if (ex.code === 'slot_taken') {
          err.textContent = t.slotTaken;
          setTimeout(() => { renderTime(); }, 1400);
        } else err.textContent = ex.code === 'closed' ? t.closed : ex.code === 'invalid_email' ? t.invalidEmail : t.errorGeneric;
      }
    });
  }

  // --------------------------------------------------------------- done
  function confetti() {
    const colors = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', getComputedStyle(document.documentElement).getPropertyValue('--brand')];
    let out = '';
    for (let i = 0; i < 28; i++) {
      out += `<i style="left:${10 + Math.random() * 80}%;background:${colors[i % colors.length]};--dx:${Math.round((Math.random() - 0.5) * 160)}px;--rot:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${(Math.random() * 0.25).toFixed(2)}s"></i>`;
    }
    return out;
  }

  function renderDone() {
    const r = state.result;
    const pending = r.status === 'pending';
    const el = $('#step-done');
    el.innerHTML = `<div class="done">
        <div class="confetti">${confetti()}</div>
        <svg class="check-anim" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><path d="M30 52 l14 14 l27 -30"/></svg>
        <h2 style="justify-content:center">${esc(pending ? t.pendingTitle : t.booked)}</h2>
        <p class="muted">${esc((pending ? t.pendingHint : t.bookedHint).replace('{shop}', shop.name))}</p>
      </div>
      ${r.deposit ? `<div class="deposit-card">
        <b>${ic('cash')}${esc(t.depositTitle.replace('{amount}', money(r.deposit)))}</b>
        ${r.payOnline ? `<button class="btn" type="button" id="pay-online">${ic('cash')}${esc(t.payDepositOnline)}</button>` : ''}
        ${!r.payOnline && r.paymentInfo ? `<p class="pay-info">${esc(r.paymentInfo)}</p>` : ''}
        <p class="muted small">${esc(t.depositHint)}</p>
        ${!r.payOnline && r.paymentLink ? `<a class="btn" href="${esc(r.paymentLink)}" target="_blank" rel="noopener">${ic('cash')}${esc(t.payNow)}</a>` : ''}
      </div>` : ''}
      ${summaryCard().replace('class="summary-card"', 'class="summary-card ticket-lite"')}
      <div class="actions">
        ${shop.whatsapp ? `<a class="btn wa" href="${esc(r.whatsappUrl)}" target="_blank" rel="noopener">${ic('whatsapp')}${esc(t.sendWhatsApp)}</a>` : ''}
        <a class="btn" href="${esc(r.icsUrl)}" download>${ic('calendar-plus')}${esc(t.addCalendar)}</a>
        <div class="manage-link">${ic('link')}<span>${esc(r.manageUrl)}</span><button type="button" id="copy">${ic('copy')}${esc(t.copyLink)}</button></div>
        <a class="btn ghost" href="${esc(r.manageUrl)}">${ic('calendar')}${esc(t.manageLink)}</a>
        <button class="btn ghost" type="button" id="again">${ic('plus')}${esc(t.bookAnother)}</button>
      </div>`;
    show('done');
    const pay = $('#pay-online', el);
    if (pay) pay.addEventListener('click', async () => {
      pay.disabled = true;
      try {
        const x = await api('POST', `/api/bookings/${encodeURIComponent(r.token)}/checkout`, {});
        location.href = x.url;
      } catch {
        toast(t.payFailed);
        pay.disabled = false;
      }
    });
    $('#copy', el).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(r.manageUrl); toast(t.linkCopied); } catch { /* ignore */ }
    });
    $('#again', el).addEventListener('click', () => {
      state.result = null;
      state.service = null;
      $$('.svc').forEach((b) => b.classList.remove('sel'));
      show('service');
    });
  }

  // ------------------------------------------------------------- extras
  const shareBtn = $('#share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) await navigator.share({ title: shop.name, url });
        else { await navigator.clipboard.writeText(url); toast(t.linkCopied); }
      } catch { /* cancelled */ }
    });
  }
  const langSel = $('#lang');
  if (langSel) {
    langSel.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('lang', langSel.value);
      location.href = url.toString();
    });
  }

  // Live preview from the admin's design screen (same origin only).
  if (D.preview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'mawid-preview') return;
      const d = e.data;
      if (d.theme) document.body.className = document.body.className.replace(/theme-\w+/, `theme-${d.theme}`);
      if (d.color) document.documentElement.style.setProperty('--brand', d.color);
      if (d.fontStack) document.documentElement.style.setProperty('--font', d.fontStack);
      if (d.fontHref) $('#font-css').href = d.fontHref;
      if ('logo' in d) $('#logo').innerHTML = d.logo ? `<img src="${esc(d.logo)}" alt="">` : `<span>${esc((shop.name || '?').charAt(0).toUpperCase())}</span>`;
      if ('cover' in d) {
        const cover = $('#cover');
        cover.classList.toggle('has-img', !!d.cover);
        const img = $('img', cover);
        if (d.cover) {
          if (img) img.src = d.cover;
          else cover.insertAdjacentHTML('afterbegin', `<img src="${esc(d.cover)}" alt="">`);
        } else if (img) img.remove();
      }
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && !a.getAttribute('href').startsWith('#')) e.preventDefault();
    }, true);
  }

  if (D.preselect && services.has(D.preselect)) pickService(D.preselect);
})();
