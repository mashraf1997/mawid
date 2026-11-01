<div align="center">

<img src="docs/hero.png" alt="Mawid — your own booking page" width="100%">

# Mawid · موعد

**Your own appointment booking page — for salons, barbers, clinics and coaches.**
Self-hosted. No monthly fees. No commissions. 8 languages.

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/docker-hosting?compose_url=https://raw.githubusercontent.com/mashraf1997/mawid/main/docker-compose.yml&REFERRALCODE=YOUR_REFERRAL_CODE)

[English](README.md) · [العربية](README.ar.md)

</div>

---

## Why Mawid?

Barbers, salons, clinics, tutors and trainers still book most appointments by phone and WhatsApp chat — back-and-forth messages, double bookings, forgotten appointments. Booking SaaS fixes that for **$20–$60 a month per staff member**, usually without proper Arabic or WhatsApp support.

Mawid gives every business its **own booking page** on its own server and domain:

1. **Deploy** with one click (HTTPS included).
2. **Pick your type of business** — barbershop, beauty salon, clinic, coach — and start with ready-made services and team, or add your own.
3. **Share the link or QR code.** Customers pick a service, a specialist, a free time and they're booked. You see it instantly, and remind them on WhatsApp with one tap.

<img src="docs/flow.png" alt="Booking in four taps" width="100%">

## Features

**For customers**
- 📅 Book in four taps: service → specialist (or *anyone available*) → day & time → details
- ⏱️ Only truly free times are shown — working hours, each person's schedule, existing bookings, breaks between services and time off are all taken into account
- 📲 Confirmation screen with **Add to calendar** (.ics with a reminder), WhatsApp, and a **private link to view or cancel** the booking
- 🌍 **8 languages** (English, العربية with full RTL, Español, Português, Français, Türkçe, Bahasa Indonesia, हिन्दी), light & dark mode, remembers name and phone

**For the business**
- 🗓️ **Today** dashboard: schedule timeline, requests waiting for confirmation, revenue with trend, no-show rate, busiest days, top services
- 🔔 **WhatsApp reminders for tomorrow's customers** — one tap opens WhatsApp with a ready-made, translated reminder (local numbers get your country code automatically)
- 📆 **Week calendar** per person or for the whole team; click an empty slot to add a booking, click a booking to confirm, complete, mark no-show, cancel or **reschedule** (only free times are offered)
- ☎️ **Manual bookings** for phone calls and walk-ins — your rules don't apply, but double-booking is still impossible
- 👥 **Team**: each person can have their own working hours and **time off**; services can be limited to certain people; "anyone" spreads bookings fairly
- ✂️ **Services** with duration, price and a **break after** (cleanup / rest time)
- ⚙️ **Booking rules**: auto-confirm or approve each booking, slot interval, minimum notice, how far ahead, cancellation window, booking policy
- 🎨 **Design** tab with **4 themes** (Modern, Soft, Elegant, Bold), 5 Arabic-friendly fonts, any colour, logo and cover — with a **live phone preview**
- 💳 **Deposits**: ask online customers to pay a percentage up front by InstaPay, mobile wallet, bank transfer or a payment link; the booking waits until you mark the deposit received ([how](#deposits))
- 📲 **Instant Telegram notifications** for new bookings and cancellations, free with your own bot
- 🔔 Sound alert for new bookings, QR code and printable poster, backups

**For the server**
- Node.js + Express, **2 dependencies**, no database to set up (atomic JSON files)
- Runs on the smallest VPS
- **Automatic HTTPS** with Caddy, **setup code** to protect a fresh install, **demo mode**
- **Agency mode**: one server hosts many clients, each on their own domain ([details](#agency-mode-host-all-your-clients-on-one-server))
- Tested availability engine (time zones, buffers, overlapping staff, "until midnight" hours)

## Screenshots

| Today | Week calendar | Booking details |
|---|---|---|
| <img src="docs/admin-today.png" width="320"> | <img src="docs/admin-calendar.png" width="320"> | <img src="docs/admin-booking.png" width="320"> |

| Design + live preview | Team & time off | Arabic booking page |
|---|---|---|
| <img src="docs/admin-design.png" width="320"> | <img src="docs/admin-team.png" width="320"> | <img src="docs/book-ar.png" width="200"> |

What the business receives on WhatsApp:

```text
📅 *New booking #1042*
🏪 Studio Luna
━━━━━━━━━━
💅 Gel manicure · 45 min — $25
👤 With: Nour
🗓️ Tuesday, November 3 · 2:30 PM
━━━━━━━━━━
🙋 Customer: Maya Haddad
📞 Phone: +1 415 555 0142
```

## Deploy

### Option 1 — One click on a Hostinger VPS (recommended)

1. Click **Deploy on Hostinger** above. Docker Manager reads [`docker-compose.yml`](docker-compose.yml), which runs Mawid behind [Caddy](https://caddyserver.com).
2. **HTTPS:** point your domain's DNS **A record** at the VPS and set `DOMAIN=book.example.com`. Caddy gets the certificate automatically.
3. **Setup code:** open the `mawid` container's **logs** in Docker Manager and copy `Setup code: XXXX-XXXX` — or set your own with `SETUP_CODE`.
4. Open your domain, go to `/admin`, enter the code and finish the 1-minute setup.

### Option 2 — Hostinger Node.js web app

1. hPanel → **Websites → Add website → Node.js app → Import Git repository**, pick your fork.
2. Framework **Express**, Node **20+**, entry file `server.js`.
3. Environment variables: `SETUP_CODE` (any code you choose) and `DATA_DIR` (a folder **outside** the app folder, e.g. `/home/<user>/mawid-data`).
4. Deploy and open `/admin`.

### Option 3 — Docker anywhere

```bash
curl -O https://raw.githubusercontent.com/mashraf1997/mawid/main/docker-compose.yml
```

```bash
DOMAIN=book.example.com docker compose up -d
```

```bash
docker compose logs mawid | grep "Setup code"
```

### Option 4 — Plain Node.js

```bash
git clone https://github.com/mashraf1997/mawid.git
cd mawid
npm install --omit=dev
npm start
```

## Agency mode: host all your clients on one server

Freelancers and agencies can run **one Mawid server for many clients**. Each client gets their own fully separate booking page (own admin, password, data and photos) at `client.yourdomain.com` or their own domain, with automatic HTTPS. You manage everyone from one panel at `/hub`.

<img src="docs/hub.png" alt="Agency panel" width="100%">

- ➕ **New client in seconds**: pick a name and address, then send the link and setup code on WhatsApp in one tap
- 🌐 **Subdomains or custom domains**, with HTTPS certificates issued automatically on the first visit
- 💰 **Billing tracker**: monthly fee, *paid until*, due-soon and overdue lists, and a one-tap *Paid +1 month*
- ⏸️ **Suspend** clients who don't pay (their page shows "temporarily unavailable") and resume them in one click
- 🔑 **Reset a client's password** when they forget it, plus bookings per client for the last 30 days
- 🗑️ Deleting a client moves their data to a `trash/` folder instead of erasing it

**Set up** (with [`examples/agency/`](examples/agency)):

1. Point two DNS records at your server: `apps.example.com` and the wildcard `*.apps.example.com`.
2. Run the compose file with `BASE_DOMAIN=apps.example.com`.
3. Open `https://apps.example.com/hub` and enter the setup code from `docker compose logs mawid`.

Clients then live at `https://<name>.apps.example.com`. To use a client's own domain, add it in the panel and have them point its A record at your server. Caddy only requests certificates for addresses the panel knows about (`/_hub/tls-check`), so nobody can make your server request certificates for other domains.

To try it locally, run `HUB_MODE=true npm start` and open `http://localhost:3000/hub`. Clients work at `http://<name>.localhost:3000` in Chrome and Firefox.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` (`/data` in Docker) | Settings, services, team, bookings, photos |
| `SETUP_CODE` | random, printed in the logs | Required to create the admin account on a fresh install |
| `DOMAIN` | *(empty)* | **docker-compose only.** Your domain for automatic HTTPS |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Express `trust proxy` setting |
| `DEMO_MODE` | `false` | Public demo that resets itself (see below) |
| `DEMO_PASSWORD` | `demo1234` | Admin password shown in the demo |
| `DEMO_RESET_MINUTES` | `60` | Demo reset interval |
| `DEMO_LANG` / `DEMO_TYPE` | `en` / `salon` | Demo language and business type (`barber`, `salon`, `clinic`, `coach`, `other`) |
| `HUB_MODE` | `false` | `true` turns the server into an [agency hub](#agency-mode-host-all-your-clients-on-one-server) for many clients |
| `BASE_DOMAIN` | `localhost` | Agency mode: clients get `<name>.BASE_DOMAIN` |
| `HUB_DOMAIN` | *(empty)* | Agency mode: only show the panel on this host |

### Live demo

```bash
docker run -d -p 80:3000 -e DEMO_MODE=true ghcr.io/mashraf1997/mawid:latest
```

A salon with a team, a month of realistic bookings and visitor stats. Visitors can log in with the password shown on screen; password changes and restores are disabled, and everything resets every hour.

### Deposits

No-shows cost money, so Mawid can ask for a deposit on online bookings. In **Settings → Deposits**, set:

- **Deposit for online bookings**: a percentage of the service price (`0` turns it off)
- **How customers pay**: free text, for example `InstaPay: name@instapay · Vodafone Cash 010…`
- **Payment link** (optional): any checkout page, such as a Stripe, PayPal or Paymob payment link

After booking, the customer sees the amount, your payment details and a **Pay now** button, on the confirmation screen and on their private booking page. A booking with a deposit stays **pending** (even with auto-confirm on) until you press **Deposit received** on the Today screen or in the booking, which confirms it. Bookings you add yourself never ask for a deposit. Mawid doesn't handle money itself, so there are no fees and no payment keys to manage.

### Telegram notifications

Get a free, instant message on your phone for every new booking or customer cancellation, even when the admin panel is closed:

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot` and copy the token it gives you.
2. Paste the token in **Settings → Instant notifications (Telegram)**, then open your new bot and press **Start**.
3. Press **Find my chat**, then **Send test**.

The message includes a link straight to the Today screen. To send notifications to a group, add the bot to the group and send a message there before pressing *Find my chat*. The bot token is stored on your server only: it's never shown again in the browser and is left out of backups.

### Multiple branches

Each branch runs its own copy of Mawid: its own admin, services, team, calendar, data and WhatsApp number, usually on its own subdomain (`downtown.example.com`, `mall.example.com`…). Copies are tiny (about 60 MB of RAM each), so one small VPS can run many.

[`examples/branches/`](examples/branches) has a ready-to-use `docker-compose.yml` and `Caddyfile` for two branches behind automatic HTTPS. To add a branch, copy a service block, give it a new volume, and add one line to the `Caddyfile`. Point each subdomain's DNS at the server, run `docker compose up -d`, and open each subdomain's `/admin` to set it up. On a Hostinger VPS you can also deploy the template several times instead.

### How availability works

For each day, Mawid takes the business hours (or the person's own hours), steps through start times every *slot interval*, and keeps a time only if the whole service **plus its break** fits before closing and doesn't overlap any other booking (including that booking's break) or time off. Times inside the *minimum notice* or beyond the *booking horizon* are hidden. When a customer picks *anyone*, the booking goes to whoever is free with the fewest bookings that day. The engine lives in [`src/availability.js`](src/availability.js) and has its own test suite.

## Security

- A fresh install can only be claimed with the **setup code**.
- scrypt password hashing, signed `HttpOnly` / `SameSite=Strict` session cookies, CSRF header check, rate-limited login, setup and booking endpoints.
- Every booking is re-validated on the server against live availability — no double booking even if two people tap the same time.
- Each customer's manage link uses a random 96-bit token.

## Development

```bash
npm install
npm run dev
npm test       # availability engine, API and locale tests
```

```
src/availability.js  free-slot engine
src/bookings.js      validation, WhatsApp messages, .ics files
src/app.js           routes & API
src/views.js         booking page, manage page, QR poster
locales/             one JSON file per language
public/              booking page & admin (vanilla JS + CSS)
```

## License

[MIT](LICENSE)
