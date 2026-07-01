# Property Visual Explorer — Phase 4 Developer Brief

**Product:** Property Visual Explorer
**Client:** Pankaj — Wayne E Solutions
**Phase:** 4 (continued) — Inbound WhatsApp webhook, plot boundary tracer, lead scoring, user invite / change password, integrated from a Gemini code batch

---

## Read this first: what this batch actually is

This wasn't written from scratch — it's an integration pass over code Gemini
generated against five task prompts (webhook, plot tracer, RLS, lead
scoring, invite/password). Gemini's output arrived as ~28 loose files with
generic names (`gemini-code-<timestamp>.js`), not a project structure, and
several of them would have caused real damage if pasted in directly. This
brief documents what got merged, what got fixed first, and — importantly —
**what got deliberately left out and why.**

## ⚠️ Held back entirely: Row-Level Security

Gemini's RLS migration + middleware is **not included in this batch**. Two
compounding bugs would have made it actively harmful if merged as delivered:

1. **Connection pooling.** The middleware calls `set_config('app.current_tenant_id', ...)` on whatever pooled connection it happens to grab at that moment. Knex doesn't pin one physical connection to one request — the very next query in the same request can land on a different pooled connection that never had the tenant ID set on it.
2. **Middleware ordering.** It was wired in *before* `authGuard` runs, so `req.user` doesn't exist yet when the RLS-context middleware checks for it — meaning the tenant context never gets set on any connection, ever.

Together: turning RLS on as delivered would make every dashboard query
return zero rows (RLS blocks anything that doesn't match a tenant context
that was never actually set). Enabling it correctly needs each
tenant-scoped request wrapped in its own `knex.transaction()`, with
`SET LOCAL` run inside that same transaction — a real change to how
every dashboard controller acquires its DB connection, not a drop-in
middleware. That's worth doing properly as its own task, not squeezed into
this batch. Your app-layer tenant scoping (`WHERE tenant_id = req.user.tenant_id`
on every query) is still the primary enforcement today and hasn't changed.

## ⚠️ Held back: voice-note transcription pipeline

Gemini built an entire unrequested feature — a migration
(`listing_audio_transcripts` table + `leads.audio_recording_url`), a
controller, a route, and a BullMQ worker for ingesting voice notes and
transcribing them. Not broken, just not something anyone asked for, and it
would have added a fifth worker to run and another competing route file.
Left out. Say the word if you actually want this and I'll integrate it
properly next round.

## What's actually in this batch

- **Inbound WhatsApp webhook** (`POST /api/v1/webhooks/whatsapp/inbound`) — the missing trigger for `vocallmWorker.js`'s AI-reply pipeline. Resolves the thread/lead/listing, logs the inbound message, queues the AI reply job.
- **Plot boundary tracer** — real Mapbox GL Draw implementation replacing the Phase 1 stub. Traces a polygon, saves it via `PATCH /api/v1/dashboard/listings/:id/boundary`.
- **Lead scoring** — the 0-100 weighted model from the Tech Stack doc (Ch.11.3), now feeding into `GET /api/v1/dashboard/analytics`.
- **Change password** (`POST /api/v1/auth/change-password`) and **invite a second user** (`POST /api/v1/dashboard/users/invite`, owner-only).

## Bugs found and fixed before merging

| Issue | Fix |
|---|---|
| **Two of Gemini's rewritten `app.js` files drop the `/api/v1/auth` route mount entirely** — login would 404 site-wide if either got pasted in whole. Both also reference files that don't exist in this repo (`routes/listings.js`, `middleware/tenantIsolation.js`). | Didn't use either. Added one route (`/api/v1/webhooks`) to the real `app.js`, keeping every existing mount. |
| **`authController.js`/`routes/auth.js` snippets contain `changePassword` only** — the comment says "keeping login intact" but the code shown doesn't include it; pasted as full files, both would have deleted login. | Added `changePassword` to the real `authController.js` alongside the existing `login`, and added the route to the real `routes/auth.js` without touching the existing `/login` route. |
| **A new `routes/listings.js` competes with the real `routes/dashboard.js` and drops `getListings`** — the endpoint the dashboard UI actually calls to display properties. If it had replaced `dashboard.js`, the dashboard would go blank. | Added the boundary route into the real `dashboard.js` instead of creating a second file. |
| **`PlotBoundaryTracer.jsx` and `ChangePassword.jsx` both used raw `fetch()` with no Authorization header** against `authGuard`-protected endpoints — every save/password-change would 401 immediately. | Both now use `apiClient` (the JWT-attaching axios instance from the Phase 3 batch). |
| **Lead scoring's "+20 replied within 24hr window" fetched `service_window_expires_at` but never compared anything against it** — any reply, however old, scored the +20. | Rewrote the check to actually compare the inbound message timestamp against the thread's service window. |
| **My own bug, caught in testing**: the lead-scoring rewrite queried `listing_visits.created_at`, which doesn't exist — that column is `visited_at`. Crashed the analytics endpoint until caught. | Fixed both references. |
| **Webhook thread lookup only matched by `bsp_thread_ref`** — a lead whose earlier thread was opened via the public-page phone prompt (no BSP ref yet) got a *second* duplicate thread on their first real inbound message. Caught by testing two inbound messages against the same lead. | Added a fallback lookup for an existing open thread by `lead_id` + `listing_id` before creating a new one — same dedup pattern already used in `capturePublicLead`. Backfills the BSP ref onto the reused thread. |
| **Webhook signature check computed HMAC over `JSON.stringify(req.body)`** — the re-stringified parsed object won't byte-match what a real BSP actually signed. | `app.js` now captures the raw request body via `express.json()`'s `verify` option; the signature check uses those exact bytes. |
| **`client/package.json` never listed `mapbox-gl` / `@mapbox/mapbox-gl-draw`** even though the new tracer imports them directly. | Added both, plus the Mapbox CSS links in `client/index.html` and `VITE_MAPBOX_ACCESS_TOKEN` in a new `client/.env.example`. |

## Known, accepted limitation (not fixed — flagging for later)

The webhook's fallback tenant resolution picks "the oldest active tenant"
when an inbound message comes from an unrecognized phone number. Fine with
one tenant (you, today). The moment a second paying tenant exists, this
becomes genuinely ambiguous — nothing in the payload currently tells us
which tenant's WhatsApp number the message arrived on. Most BSPs include a
`to` field with the receiving number; wire that against
`tenants.whatsapp_number` before Phase 7 (external tenants).

## What I Verified (not just wrote)

All of it run against real Postgres + Redis before being handed off:

- Login, existing `GET /listings`, and analytics all still work — nothing
  broke in the merge.
- `POST /users/invite` creates a real agent user with a working temp password.
- `POST /auth/change-password` verifies the current password and rotates it.
- `PATCH /listings/:id/boundary` writes real GeoJSON into `listing_media`, tenant-checked.
- Sent two inbound webhook payloads against the same lead with different
  conversation IDs — confirmed only one thread exists (not two), the second
  call reused the first and backfilled its `bsp_thread_ref`, and the
  inbound message got logged and the AI-reply job queued both times.
- Lead score correctly returned 55 (35 phone + 20 in-window reply) after
  the webhook test — verified the arithmetic by hand against the doc's
  spec, not just that it ran without error.
- `client` builds clean with `npm run build` (154 modules, including
  Mapbox GL — expect a "large chunk" warning, that's just Mapbox being
  Mapbox, not an error).

## Setup — what's new since Phase 3

```bash
# Backend — no new dependencies
npm install
npm run migrate   # no new migrations this batch — RLS was held back

# Add to .env:
WHATSAPP_WEBHOOK_SECRET=            # leave blank in dev — signature check is skipped if unset

# Frontend — new deps for the plot tracer
cd client
npm install
cp .env.example .env      # then fill in VITE_MAPBOX_ACCESS_TOKEN
cd ..

npm run dev
npm run workers
cd client && npm run dev
```

## What to Build Next

1. **A real WhatsApp BSP account** — same item as last brief, now more
   urgent since the inbound side is also wired up.
2. **RLS, done properly** — as a transaction-per-request refactor, not a
   drop-in middleware. Worth its own focused pass.
3. **The "to" number problem** in the webhook fallback, before any second
   tenant is onboarded.
4. **Decide on the voice-note feature** — say if you want it, and I'll
   integrate it with the same scrutiny as this batch.
5. Everything else from the Phase 3 brief that's still open (Next.js
   decision, Phase 5 pilot).

## Dev Credentials (seed only — unchanged)

| | |
|---|---|
| Email | admin@wayneesolutions.com |
| Password | Password123! |
