'use strict';

const { strings } = require('./i18n');
const { cleanTheme, fontHref, fontStack, hueFor } = require('./theme');
const B = require('./bookings');
const A = require('./availability');

const VERSION = require('../package.json').version;
const ICONS = `/img/icons.svg?v=${VERSION}`;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#7c3aed');
const safeUrl = (u) => (/^(https?:\/\/|\/uploads\/)/i.test(String(u || '').trim()) ? String(u).trim() : '');
const initials = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;

function socialUrl(kind, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const h = encodeURIComponent(v.replace(/^@/, ''));
  return { instagram: `https://instagram.com/${h}`, facebook: `https://facebook.com/${h}`, tiktok: `https://www.tiktok.com/@${h}` }[kind];
}

/** "Open now · until 20:00" style status from weekly hours. */
function openStatus(s, t, lang, now) {
  const day = (s.hours || [])[A.dayOfWeek(now.date)];
  if (!day || !day.open) return { open: false, text: t.closedToday };
  const from = A.toMin(day.from);
  let to = A.toMin(day.to);
  if (to <= from) to = 1440;
  const open = now.minutes >= from && now.minutes < to;
  return {
    open,
    text: `${open ? t.openNow : t.closedNow} · ${B.timeLabel(from, lang)} – ${B.timeLabel(to % 1440, lang)}`,
  };
}

function head({ s, lang, t, title, description, baseUrl, extra = '', robots = '' }) {
  const color = safeColor(s.color);
  const logo = safeUrl(s.logo);
  const og = safeUrl(s.cover) || logo;
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${color}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${og ? `<meta property="og:image" content="${esc(baseUrl + og.replace(/^\//, ''))}">` : ''}
${robots ? `<meta name="robots" content="${robots}">` : ''}
${extra}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${logo ? esc(logo) : '/img/icon.svg'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" id="font-css" href="${esc(fontHref(s.font, lang))}">
<link rel="stylesheet" href="/css/book.css?v=${VERSION}">
<style id="vars">:root{--brand:${color};--font:${fontStack(s.font)}}</style>
</head>`;
}

function shopHeader({ s, t, lang, now, languages }) {
  const cover = safeUrl(s.cover);
  const logo = safeUrl(s.logo);
  const status = openStatus(s, t, lang, now);
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  const mapUrl = safeUrl(s.mapUrl);
  const quick = [
    digits && `<a class="qa wa" href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>`,
    s.phone && `<a class="qa" href="tel:${esc(s.phone)}" aria-label="${esc(t.call)}">${icon('phone')}</a>`,
    mapUrl && `<a class="qa" href="${esc(mapUrl)}" target="_blank" rel="noopener" aria-label="${esc(t.directions)}">${icon('pin')}</a>`,
    s.instagram && `<a class="qa" href="${esc(socialUrl('instagram', s.instagram))}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>`,
    s.tiktok && `<a class="qa" href="${esc(socialUrl('tiktok', s.tiktok))}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>`,
    `<button class="qa" type="button" id="share" aria-label="${esc(t.share)}">${icon('share')}</button>`,
  ].filter(Boolean);
  const langMenu = languages.length > 1
    ? `<label class="lang">${icon('globe')}<select id="lang" aria-label="${esc(t.language)}">${languages
        .map((l) => `<option value="${esc(l.code)}"${l.code === lang ? ' selected' : ''}>${esc(l.name)}</option>`)
        .join('')}</select></label>`
    : '';
  return `<header class="hero">
  <div class="cover${cover ? ' has-img' : ''}" id="cover">${cover ? `<img src="${esc(cover)}" alt="" fetchpriority="high">` : ''}
    <div class="topbar">${langMenu}</div>
  </div>
  <div class="shop-card">
    <div class="logo" id="logo">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`}</div>
    <h1>${esc(s.name)}</h1>
    ${s.tagline ? `<p class="tagline">${esc(s.tagline)}</p>` : ''}
    <p class="status ${status.open ? 'open' : 'closed'}"><span class="dot"></span>${icon('clock', 'i xs')}${esc(status.text)}</p>
    <div class="quick">${quick.join('')}</div>
  </div>
</header>`;
}

function footer({ s, t, lang, team }) {
  const days = (s.hours || []).map((d, i) => {
    const name = new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));
    return `<li><span>${esc(name)}</span><b>${d.open ? `${esc(B.timeLabel(A.toMin(d.from), lang))} – ${esc(B.timeLabel(A.toMin(d.to) % 1440, lang))}` : `<i>${esc(t.closedDay)}</i>`}</b></li>`;
  });
  return `<footer class="footer">
  ${team.length ? `<section class="info-card"><h3>${icon('users')}${esc(t.team)}</h3><div class="team">${team
    .map((m) => `<div class="member"><div class="avatar" style="--h:${hueFor(m.name)}">${safeUrl(m.photo) ? `<img src="${esc(m.photo)}" alt="">` : esc(initials(m.name))}</div><b>${esc(m.name)}</b>${m.title ? `<small>${esc(m.title)}</small>` : ''}</div>`)
    .join('')}</div></section>` : ''}
  <section class="info-card">
    <h3>${icon('clock')}${esc(t.hours)}</h3>
    <ul class="hours">${days.join('')}</ul>
    ${s.address ? `<p class="addr">${icon('pin')}${safeUrl(s.mapUrl) ? `<a href="${esc(safeUrl(s.mapUrl))}" target="_blank" rel="noopener">${esc(s.address)}</a>` : esc(s.address)}</p>` : ''}
  </section>
  ${s.about || s.policy ? `<section class="info-card">${s.about ? `<p>${esc(s.about)}</p>` : ''}${s.policy ? `<h3>${icon('file')}${esc(t.policy)}</h3><p class="muted">${esc(s.policy)}</p>` : ''}</section>` : ''}
  ${powered(s, t)}
</footer>`;
}

/** "Powered by" line; agencies can rename it or hide it (white-label). */
function powered(s, t) {
  const b = s._brand;
  if (b && b.hideBranding) return '';
  if (b && b.name) {
    const u = safeUrl(b.url);
    return `<p class="powered">${esc(t.poweredBy)} ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(b.name)}</a>` : esc(b.name)}</p>`;
  }
  return `<p class="powered">${esc(t.poweredBy)} <a href="https://github.com/mashraf1997/mawid" target="_blank" rel="noopener">Mawid</a></p>`;
}

function renderBookingPage({ settings: s, services, staff, lang, baseUrl, now, demo = false, preview = false, languages = [], preselect = '' }) {
  const t = strings(lang);
  const team = staff.filter((m) => m.active !== false);
  const visible = services.filter((x) => x.active !== false);
  const theme = cleanTheme(s.theme);
  const clientData = {
    lang,
    t,
    icons: ICONS,
    preview,
    today: now.date,
    preselect,
    shop: {
      name: s.name,
      currency: s.currency,
      maxDays: Math.max(1, Number(s.maxDays) || 30),
      accepting: !!s.acceptingBookings,
      whatsapp: s.whatsapp,
    },
    services: visible.map((x) => ({
      id: x.id,
      name: x.name,
      description: x.description || '',
      duration: Number(x.duration) || 30,
      price: Number(x.price) || 0,
      emoji: x.emoji || '',
      hue: hueFor(x.name),
      staffIds: x.staffIds || [],
    })),
    staff: team.map((m) => ({ id: m.id, name: m.name, title: m.title || '', photo: safeUrl(m.photo), hue: hueFor(m.name) })),
  };
  const serviceCards = visible
    .map(
      (x) => `<button type="button" class="svc" data-service="${esc(x.id)}" style="--h:${hueFor(x.name)}">
      <span class="tile">${esc(x.emoji || initials(x.name))}</span>
      <span class="svc-body"><b>${esc(x.name)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}
        <span class="meta">${icon('hourglass', 'i xs')}${esc(B.durationLabel(Number(x.duration) || 30, t))}${Number(x.price) ? `<span class="price">${esc(B.formatMoney(x.price, s.currency))}</span>` : ''}</span></span>
      ${icon('chevron', 'i chev')}
    </button>`
    )
    .join('');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: s.name,
    description: s.tagline || s.about || '',
    url: baseUrl,
    ...(s.address ? { address: s.address } : {}),
    ...(s.phone ? { telephone: s.phone } : {}),
  };
  return `${head({
    s,
    lang,
    t,
    title: `${s.name}${s.tagline ? ` — ${s.tagline}` : ''}`,
    description: s.tagline || s.about || s.name,
    baseUrl,
    robots: preview ? 'noindex' : '',
    extra: `${preview ? '' : languages.map((l) => `<link rel="alternate" hreflang="${esc(l.code)}" href="${esc(baseUrl)}?lang=${esc(l.code)}">`).join('\n')}
<script type="application/ld+json">${inlineJson(jsonLd)}</script>`,
  })}
<body class="theme-${theme}">
${shopHeader({ s, t, lang, now, languages })}
${demo ? `<div class="notice demo" role="note">${icon('sparkles')}<span>${esc(t.demoBanner)}</span></div>` : ''}
${s.acceptingBookings ? '' : `<div class="notice closed" role="status">${icon('x-circle')}<span>${esc(t.closed)}</span></div>`}
<main id="flow" class="flow">
  <ol class="steps" id="steps" aria-hidden="true">
    <li data-step="service" class="on"><span>1</span></li>
    <li data-step="staff"><span>2</span></li>
    <li data-step="time"><span>3</span></li>
    <li data-step="details"><span>4</span></li>
  </ol>
  <section class="step" id="step-service">
    <h2>${esc(t.chooseService)}</h2>
    <div class="svcs">${serviceCards || `<p class="empty">${esc(t.noServices)}</p>`}</div>
  </section>
  <section class="step" id="step-staff" hidden></section>
  <section class="step" id="step-time" hidden></section>
  <section class="step" id="step-details" hidden></section>
  <section class="step" id="step-done" hidden></section>
</main>
${footer({ s, t, lang, team })}
<div class="bar" id="bar" hidden>
  <div class="bar-in"><div class="bar-sum" id="bar-sum"></div><button type="button" class="btn" id="bar-next">${esc(t.next)}${icon('arrow-right', 'i flip')}</button></div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.MAWID=${inlineJson(clientData)};</script>
<script src="/js/book.js?v=${VERSION}" defer></script>
</body>
</html>`;
}

/** Customer's own page for one booking: details, add to calendar, cancel. */
function renderManagePage({ settings: s, booking: b, lang, baseUrl, now, canCancel, languages = [], payOnline = false, payPending = false, justPaid = false }) {
  const t = strings(lang);
  const theme = cleanTheme(s.theme);
  if (!b) {
    return `${head({ s, lang, t, title: s.name, description: s.name, baseUrl, robots: 'noindex' })}
<body class="theme-${theme}">${shopHeader({ s, t, lang, now, languages: [] })}
<main class="flow"><div class="ticket"><p class="empty">${icon('x-circle')}<br>${esc(t.notFound)}</p><a class="btn" href="/">${esc(t.bookNow)}</a></div></main></body></html>`;
  }
  const statusCls = { pending: 'warn', confirmed: 'ok', completed: 'ok', noshow: 'bad', cancelled: 'bad' }[b.status];
  const digits = String(s.whatsapp || '').replace(/\D/g, '');
  return `${head({ s, lang, t, title: `${t.yourBooking} — ${s.name}`, description: s.name, baseUrl, robots: 'noindex' })}
<body class="theme-${theme}">
${shopHeader({ s, t, lang, now, languages: [] })}
<main class="flow">
  <div class="ticket" data-token="${esc(b.token)}">
    <div class="ticket-head">
      <span class="tile big" style="--h:${hueFor(b.serviceName)}">${esc(b.emoji || initials(b.serviceName))}</span>
      <div><small class="muted">${esc(t.yourBooking)} #${esc(b.no)}</small><h2>${esc(b.serviceName)}</h2>
      <span class="pill ${statusCls}">${esc(t[`status_${b.status}`])}</span></div>
    </div>
    <dl class="kv">
      <div><dt>${icon('calendar')}${esc(t.when)}</dt><dd>${esc(B.dateLabel(b.date, lang))}<br><b>${esc(B.timeLabel(b.start, lang))} – ${esc(B.timeLabel(b.end, lang))}</b></dd></div>
      ${b.staffName ? `<div><dt>${icon('user')}${esc(t.with)}</dt><dd>${esc(b.staffName)}</dd></div>` : ''}
      <div><dt>${icon('hourglass')}${esc(t.duration)}</dt><dd>${esc(B.durationLabel(b.duration, t))}</dd></div>
      ${b.price ? `<div><dt>${icon('cash')}${esc(t.price)}</dt><dd>${esc(B.formatMoney(b.price, s.currency))}</dd></div>` : ''}
      ${s.address ? `<div><dt>${icon('pin')}${esc(t.directions)}</dt><dd>${safeUrl(s.mapUrl) ? `<a href="${esc(safeUrl(s.mapUrl))}" target="_blank" rel="noopener">${esc(s.address)}</a>` : esc(s.address)}</dd></div>` : ''}
    </dl>
    ${justPaid && b.depositPaid ? `<div class="deposit-card paid"><b>${icon('check')}${esc(t.depositReceived)}</b></div>` : ''}
    ${b.deposit && !b.depositPaid && ['pending', 'confirmed'].includes(b.status) ? `<div class="deposit-card">
      <b>${icon('cash')}${esc(t.depositTitle.replace('{amount}', B.formatMoney(b.deposit, s.currency)))}</b>
      ${payPending ? `<p class="pay-confirming">${icon('clock')}${esc(t.payConfirming)}</p>` : ''}
      ${payOnline ? `<button class="btn" type="button" id="pay-online">${icon('cash')}${esc(t.payDepositOnline)}</button>` : ''}
      ${!payOnline && s.paymentInfo ? `<p class="pay-info">${esc(s.paymentInfo)}</p>` : ''}
      <p class="muted small">${esc(t.depositHint)}</p>
      ${!payOnline && safeUrl(s.paymentLink) ? `<a class="btn" href="${esc(safeUrl(s.paymentLink))}" target="_blank" rel="noopener">${icon('cash')}${esc(t.payNow)}</a>` : ''}
    </div>` : ''}
    <div class="actions">
      ${['pending', 'confirmed'].includes(b.status) ? `<a class="btn" href="/b/${esc(b.token)}.ics" download>${icon('calendar-plus')}${esc(t.addCalendar)}</a>` : ''}
      ${digits ? `<a class="btn wa" href="https://wa.me/${esc(digits)}" target="_blank" rel="noopener">${icon('whatsapp')}WhatsApp</a>` : ''}
      ${canCancel ? `<button class="btn ghost danger" type="button" id="cancel">${icon('x-circle')}${esc(t.cancelBooking)}</button>` : ''}
      ${['pending', 'confirmed'].includes(b.status) && !canCancel ? `<p class="muted small center">${esc(t.cantCancel)}</p>` : ''}
      <a class="btn ghost" href="/">${icon('calendar')}${esc(t.bookAnother)}</a>
    </div>
  </div>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
(() => {
  const pay = document.getElementById('pay-online');
  if (pay) pay.addEventListener('click', async () => {
    pay.disabled = true;
    try {
      const res = await fetch('/api/bookings/${esc(b.token)}/checkout', { method: 'POST', headers: { 'X-Mawid': '1', 'Content-Type': 'application/json' }, body: '{}' });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error);
      location.href = r.url;
    } catch {
      alert(${inlineJson(t.payFailed)});
      pay.disabled = false;
    }
  });
  const btn = document.getElementById('cancel');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!confirm(${inlineJson(t.cancelConfirm)})) return;
    btn.disabled = true;
    const res = await fetch('/api/bookings/${esc(b.token)}/cancel', { method: 'POST', headers: { 'X-Mawid': '1' } });
    if (res.ok) location.reload();
    else { alert(${inlineJson(t.cantCancel)}); btn.disabled = false; }
  });
})();
</script>
</body>
</html>`;
}

function renderPoster({ settings: s, svg, lang, url }) {
  const t = strings(lang);
  const color = safeColor(s.color);
  const logo = safeUrl(s.logo);
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${t.dir}">
<head><meta charset="utf-8"><title>QR — ${esc(s.name)}</title>
<link rel="stylesheet" href="${esc(fontHref(s.font, lang))}">
<style>
  *{box-sizing:border-box} body{font-family:${fontStack(s.font)};margin:0;background:#f4f4f1;display:grid;place-items:center;min-height:100vh}
  .poster{width:148mm;background:#fff;border-radius:28px;overflow:hidden;text-align:center;box-shadow:0 4px 30px rgba(0,0,0,.08)}
  .top{background:${color};color:#fff;padding:34px 24px 90px}
  .logo{width:84px;height:84px;border-radius:24px;background:#fff;color:${color};display:grid;place-items:center;margin:0 auto 12px;font-weight:800;font-size:38px;overflow:hidden}
  .logo img{width:100%;height:100%;object-fit:cover}
  h1{margin:0;font-size:34px} .top p{margin:6px 0 0;font-size:18px;opacity:.9}
  .qr{background:#fff;width:70%;margin:-70px auto 0;padding:16px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,.14)}
  .qr svg{width:100%;height:auto;display:block}
  .cta{font-size:26px;font-weight:800;color:${color};margin:22px 0 4px} .url{color:#666;margin:0 0 30px;font-size:15px;direction:ltr}
  .bar{position:fixed;top:12px;inset-inline-end:12px} .bar button{font:inherit;font-weight:700;padding:10px 20px;border-radius:12px;border:0;background:${color};color:#fff;cursor:pointer}
  @media print{.bar{display:none}body{background:#fff}.poster{box-shadow:none}}
</style></head>
<body><div class="bar"><button onclick="window.print()">Print</button></div>
<div class="poster"><div class="top"><div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : esc(initials(s.name))}</div><h1>${esc(s.name)}</h1>${s.tagline ? `<p>${esc(s.tagline)}</p>` : ''}</div>
<div class="qr">${svg}</div><p class="cta">📅 ${esc(t.bookNow)}</p><p class="url">${esc(url)}</p></div>
</body></html>`;
}

function renderManifest(s) {
  const logo = safeUrl(s.logo);
  return {
    name: s.name,
    short_name: String(s.name).slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: safeColor(s.color),
    icons: [logo ? { src: logo, sizes: '512x512' } : { src: '/img/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}

module.exports = { renderBookingPage, renderManagePage, renderPoster, renderManifest, esc, safeUrl };
