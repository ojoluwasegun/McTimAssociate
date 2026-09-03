# Tim - McTimothy Associates AI Associate

A working chatbot + management portal for McTimothy Associates:

- **Website widget** (`public/widget.html`) - the client-facing chat bubble. Visitors give their
  name, company, and email, then chat with **Tim** (powered by GPT-5 Mini). Tim answers from the
  FAQ knowledge base, and hands off to a live advisor on request or when he's not confident.
- **Advisor portal** (`public/advisor.html`) - advisors go active/offline, get "rung" for incoming
  chats with a 2-minute countdown, pick chats up from the queue, chat live, send receipt/calendar
  links, log complaints, raise flags, and manage their own profile.
- **Admin portal** (`public/admin.html`) - manage advisors (add/edit/delete, appraisals &
  warnings), view analytics (overall + per advisor), see visitor records, manage FAQs, brochures &
  pricing, quick answers, corporate proposal requests, review complaint logs/flags, and update the
  company profile (name, logo, address, phone).

Automated invoicing/receipts is intentionally **paused** for this version - advisors send receipt
and calendar links manually for now (see "What's next" below).

## Stack

- **Backend:** Node.js, Express, Socket.IO (real-time ringing/queue/chat), SQLite (`better-sqlite3`)
- **Frontend:** plain HTML/CSS/JS (no build step) so it's easy to lift the widget onto the real
  McTimothy Associates website
- **AI:** OpenAI GPT-5 Mini (swap the model name in `.env` if needed)

## Setup

```bash
cd server
npm install
cp .env.example .env
# then edit .env and fill in OPENAI_API_KEY, JWT_SECRET, and the seed admin login
npm start
```

The server serves both the API and the frontend, so once it's running:

- `http://localhost:4000/` - landing page linking to all three portals
- `http://localhost:4000/widget.html` - client widget demo page
- `http://localhost:4000/advisor.html` - advisor portal
- `http://localhost:4000/admin.html` - admin portal

On first run, the server automatically creates:
- One admin account, using `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`
- The 19 starter FAQs from Tim's original script
- One starter brochure entry

From the admin portal, add your real advisors, edit/replace the FAQs, brochures, and quick
answers, and update the company profile (name/logo/address/phone).

## How the queue & ringing works

- If an advisor is online and idle ("active"), a new chat request **rings** them for 2 minutes
  (shown in both the advisor portal and the client widget, with a live countdown). Any idle
  advisor can also see and accept the request from their **Queue** tab.
- If every advisor is currently busy with another chat, the visitor is placed in a **queue**
  (no countdown, just their position) until an advisor frees up or comes online.
- If no advisor is online at all, Tim tells the visitor to call the office or email, and sets
  expectations: **within 2 hours on weekdays, within 24 hours on weekends**.

## Embedding the widget on the real website

Copy the `widget-launcher` / `widget-panel` / `ringModal`-free markup from `widget.html`, the
`<link>` to `css/style.css`, the Socket.IO client script tag, and `js/widget.js` onto the target
page. Point `API`/socket connections at your deployed server's URL if the widget is hosted on a
different domain than the API (update the `io()` call and `fetch` base URL in `widget.js`, and add
that domain to `CORS_ORIGIN` in `.env`).

## Data model

See `server/db.js` for the full schema: `admins`, `advisors`, `visitors`, `chats`, `messages`,
`complaint_logs`, `faqs`, `brochures`, `proposal_requests`, `quick_answers`, `appraisals`,
`resources` (receipt/calendar links sent to clients).

## What's next (paused for now)

- Automatic invoicing: an `invoices` table + payment status, with Tim nudging the client until
  payment is confirmed, then auto-generating and emailing a receipt. The `resources` table and the
  advisor's "send a link" panel are already in place so this can be wired in without changing the
  chat UI.
- Wiring `send email` (e.g. via SMTP/SendGrid) for the receipt/2-hour SLA follow-ups referenced in
  the widget copy - right now those are informational messages only.
- WhatsApp Business API / Chatwoot channel, reusing the same `/api/chats/*` endpoints.

## Security notes before going live

- Change `JWT_SECRET` and the seed admin password immediately.
- Put this behind HTTPS and set `CORS_ORIGIN` to your real domains only.
- `better-sqlite3` is fine for a single-server deployment; move to Postgres if you need multiple
  server instances.
