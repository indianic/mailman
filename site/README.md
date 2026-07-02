# mailman — landing site

A single-page marketing site for [`@indianic/mailman`](../README.md).

- **Frontend:** React 18 + Vite + Tailwind CSS v4 + Framer Motion (dark/light theme, scroll animations)
- **Backend:** Node.js + Express
- **Database:** local PostgreSQL — stores footer newsletter subscribers

## Layout

```
site/
  client/          React SPA (Vite)
    src/
      components/   Navbar, Hero, Features, HowItWorks, Install, Footer, ThemeToggle, Reveal
      pages/        Home, Privacy, Terms
  server/          Express API + static host
    index.js       /api/subscribe, /api/health, SPA fallback
    db.js          pg pool + schema init
```

## Prerequisites

- Node 18+
- Local PostgreSQL running, with role `kalpesh` (empty password) and database `mailman_site`.

```bash
createdb -U kalpesh mailman_site   # table auto-creates on server boot
```

## Install

```bash
cd site
npm run install:all       # installs server + client deps
cp server/.env.example server/.env
```

## Develop (two terminals)

```bash
npm run dev:server        # Express on :4000
npm run dev:client        # Vite on :5173 (proxies /api → :4000)
```

Open http://localhost:5173.

## Production (single process)

```bash
npm run build             # builds client → client/dist
npm start                 # Express serves API + client/dist on :4000
```

Open http://localhost:4000.

## Service control (`service.sh`)

A wrapper that runs the production server in the background:

```bash
./service.sh start        # build (if needed) + start on the .env PORT
./service.sh stop         # stop and free the port
./service.sh restart      # stop then start
./service.sh status       # running? PID + health check
./service.sh logs         # follow server.log (Ctrl-C to exit)
./service.sh build        # rebuild the client only
```

PID is tracked in `.server.pid`; output goes to `server.log`.

## Subscribers & welcome emails

When someone subscribes via the footer, the server stores them in `subscribers`
and sends a **welcome email rendered from a DB template** (`email_templates`,
seeded with a `welcome` row using `{{brand}}` / `{{email}}` / `{{year}}`
placeholders). The same `sendTemplate(name, email)` pipeline serves leads too.

Sending uses **SendGrid** when `SENDGRID_API_KEY` is set in `server/.env`;
otherwise it runs in **dry-run** mode (renders + logs the email, no network
send) so local dev works without a key. `SENDGRID_FROM` must be a verified
sender/domain in the SendGrid account.

```sql
SELECT email, created_at, welcomed_at FROM subscribers ORDER BY created_at DESC;
SELECT name, subject FROM email_templates;         -- edit templates here
```

`/api/health` reports the active mailer mode: `{"mailer":"sendgrid"|"dry-run"}`.
