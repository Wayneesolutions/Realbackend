# Property Visual Explorer — Phase 3 Developer Brief

**Product:** Property Visual Explorer
**Client:** Pankaj — Wayne E Solutions
**Phase:** 3 — Login, Visit Logging + Soft Phone Prompt, and Phase 4 WhatsApp CTA / Lead Capture (combined)

---

## Read this first: scope note

This batch combines three things the Phase 2 brief listed under "What to
Build Next," in the order it recommended: the login page, Phase 3 (visit
logging + soft phone prompt), and Phase 4 (WhatsApp CTA + lead capture).
They were built together because Phase 4's lead-capture flow is the natural
extension of Phase 3's phone prompt — splitting them into separate PRs would
have meant building the same form twice.

**Not included:** Phase 5's pilot rollout (operational, not code), RLS
policies (Ch.12.6 — recommended before Phase 7 external tenants, not urgent
yet), and the Next.js-vs-Vite decision for `/p/:slug` flagged previously —
still open, still worth deciding before more pages depend on the current
routing.

---

## What This Package Delivers

- **A real login page** (`client/src/components/Login.jsx`) — calls
  `POST /api/v1/auth/login`, stores the JWT in `localStorage`, and redirects
  to `/dashboard`. No more devtools-console workaround.
- **`apiClient.js`** — a shared axios instance that attaches the JWT to
  every dashboard call automatically and bounces to `/login` on a 401
  (expired/invalid token) instead of failing silently.
- **`PrivateRoute.jsx`** — `/dashboard` now redirects to `/login` if there's
  no token, instead of rendering a broken page.
- **Visit logging** (`POST /api/v1/public/listings/:slug/visit`) — every
  page view on a public listing is now actually recorded, anonymous by
  default (`lead_id` null).
- **Soft phone-number prompt** on `PropertyView.jsx` — a "Share your number
  for a callback" button that expands into a small form.
- **Lead capture + WhatsApp trigger** (`POST /api/v1/public/listings/:slug/lead`)
  — this is the piece that was completely missing per the Phase 2 brief's
  gap notes. Submitting the phone form now:
  1. Dedupes/creates a `leads` row by tenant + normalized phone (Ch.11.6),
  2. Attaches the identified lead back onto the visit row that was logged
     when the page loaded,
  3. Opens (or reuses) a `whatsapp_threads` row,
  4. Queues a first-touch message onto the **same** `whatsapp-outbound`
     queue `whatsappOutboundWorker.js` already consumes — no new worker
     needed, this was the missing trigger.
- **Free WhatsApp CTA** (V4, no BSP cost) — a `wa.me` deep link on the
  public page pre-filled with a message referencing the listing, using the
  tenant's dedicated number if set, else the shared platform number.

## Issues Found and Fixed During Integration

| Issue | Fix |
|---|---|
| **`bcrypt` cannot install in most CI/sandboxed environments** — it needs to compile against Node headers and download a prebuilt binary from GitHub releases; either step fails behind a restrictive firewall/proxy (confirmed while building this batch). This would also explain the Phase 1 brief's note about Windows `cmd.exe` friction — native modules are a common pain point there too. | Swapped `bcrypt` → `bcryptjs` everywhere (`authController.js`, `01_phase0_seed.js`, `package.json`). Same API (`hash`, `compare`), pure JS, zero build step. No controller logic changed. |
| **All four BullMQ workers crash on boot** with `Error: BullMQ: Your redis options maxRetriesPerRequest must be null.` — this is a hard requirement for any Redis connection used by a `Worker` (blocking commands), and none of the four worker files had it set. This was not caught in any previous phase because the workers were apparently never actually run against a real Redis instance before being handed off. | Added `maxRetriesPerRequest: null` to the `IORedis` connection in `geoEnrichmentWorker.js`, `landmarkWorker.js`, `vocallmWorker.js`, and `whatsappOutboundWorker.js`. Confirmed all four boot clean after the fix. |
| **`tenantContext.js` calls `db.query(text, params)`**, but `db` (set in `server.js`) is a Knex instance, not a raw `pg` Pool — Knex has no `.query()` method in that form, so this would throw immediately if the middleware were ever wired into a route. It currently isn't wired anywhere, so this was dead code, not an active bug — but a landmine for whoever wires it in next. | Rewrote the public-slug branch to use the Knex query builder, consistent with every other controller in the codebase. |
| **Stray UTF-8 BOM characters** at the start of `package.json`, `src/app.js`, `knexfile.js`, and `.env.example` (left over from however earlier phases' files were generated/saved) broke Vite's config file search the moment the frontend was built for real — `vite build` failed with a JSON parse error before touching a single component. | Stripped the BOM from all four files. Confirmed `npm run build` succeeds afterward. |
| **`client/package.json` never listed `axios`** even though `DashboardListings.jsx` (Phase 1) already imported it directly — `npm install` in `client/` would have left the dashboard crashing on import the first time anyone actually ran it fresh. | Added `axios` to `client/package.json` dependencies (also needed by the new `apiClient.js` and `Login.jsx`). |
| **`tenants` table has no `whatsapp_number` column**, even though the Multi-tenancy doc (Ch.12.3) explicitly models a per-tenant WhatsApp number for dedicated-mode tenants, and the new WhatsApp CTA needs somewhere to read it from. | Added migration `20260701_01_phase3_tenant_whatsapp_number.js` (nullable `whatsapp_number` on `tenants`). Falls back to `WHATSAPP_SHARED_NUMBER` from env when null — i.e. shared mode, matching Ch.12.3's default. |

## What I Verified, Not Just Wrote

Everything below was actually run end-to-end in a throwaway environment
(Postgres 16 + Redis, seeded data) before being handed off — not just
reviewed by reading the code:

- Migrations run clean (`npm run migrate`) — all 3, including the new one.
- Seed runs clean, login returns a valid JWT.
- `GET /api/v1/dashboard/listings` and `/analytics` both work with the token.
- Created a real listing via the API; `geoEnrichmentWorker` picked up the
  job, called out to Google (failed only because no real API key was
  supplied — the failure mode itself, including exponential-backoff retries,
  behaved correctly).
- Manually flipped a listing to `active` and confirmed `GET /api/v1/public/listings/:slug`
  returns the dealer's WhatsApp digits (shared-number fallback working).
- `POST .../visit` logs a visit and returns a `visitId`.
- `POST .../lead` with that `visitId`: created a `leads` row with the phone
  correctly normalized to `+91XXXXXXXXXX`, opened a `whatsapp_threads` row,
  attached the lead back onto the visit, and queued a job that
  `whatsappOutboundWorker.js` picked up and attempted to deliver (failed
  only on the placeholder `BSP_GATEWAY_URL` — again, the correct failure
  mode, retried 3 times with backoff as configured).
- `client` builds clean with `npm run build` after the BOM fix.

## Folder Structure (changes from Phase 2 marked)

```
property-visual-explorer/
├── client/
│   └── src/
│       ├── api/
│       │   └── apiClient.js               # [NEW] JWT-attaching axios instance
│       └── components/
│           ├── Login.jsx                   # [NEW]
│           ├── PrivateRoute.jsx             # [NEW]
│           ├── DashboardListings.jsx        # [UPDATED] uses apiClient, +logout
│           ├── PropertyView.jsx             # [UPDATED] +visit log, +WhatsApp CTA, +phone prompt
│           └── PlotBoundaryTracer.jsx       (stub, unchanged — Phase 6)
├── src/
│   ├── controllers/
│   │   └── publicListingController.js       # [UPDATED] +logVisit, +capturePublicLead, +dealer info
│   ├── middleware/
│   │   └── tenantContext.js                 # [FIXED] db.query bug (still unwired/dead code)
│   ├── routes/
│   │   └── public.js                        # [UPDATED] +POST /visit, +POST /lead
│   ├── utils/
│   │   └── phone.js                         # [NEW] E.164 normalization helper
│   └── workers/                              # [FIXED] all 4: maxRetriesPerRequest: null
├── migrations/
│   └── 20260701_01_phase3_tenant_whatsapp_number.js   # [NEW]
├── .gitignore                                # [NEW]
└── (everything else unchanged from Phase 2, except bcrypt → bcryptjs and BOM strips)
```

---

## Setup Instructions

If you already have Phase 2 running:

```bash
# 1. Backend — bcrypt was replaced with bcryptjs, so reinstall clean:
rm -rf node_modules package-lock.json
npm install

# 2. Run the new migration
npm run migrate

# 3. Add to your .env:
WHATSAPP_SHARED_NUMBER=91XXXXXXXXXX     # your shared WhatsApp number, digits only, no '+'

# 4. Frontend — axios was missing from client/package.json:
cd client
rm -rf node_modules package-lock.json
npm install
cd ..

# 5. Start the API
npm run dev

# 6. Start all four workers
npm run workers

# 7. In a separate terminal, start the frontend
cd client
npm run dev
```

Then open **http://localhost:3000/login** — no more console workaround.
Log in with the seed credentials below, and you'll land on `/dashboard`
with a working "Log out" button.

To see the new public-page flow: create a listing, wait for it to flip to
`active`, open `/p/<slug>`, and try "Share your number for a callback." You
should see a `leads` row and a `whatsapp_threads` row appear, and the
outbound worker will attempt delivery (it'll fail until `BSP_GATEWAY_URL`
and `BSP_API_KEY` point at a real provider — that's expected).

---

## What to Build Next

In priority order:

1. **Get a real BSP account** (Chat Mitra / Getgabs, per the Tech Stack doc)
   and point `BSP_GATEWAY_URL` / `BSP_API_KEY` at it — the entire pipeline
   is built and tested against a fake endpoint; this is the last thing
   standing between "works in dev" and "sends a real WhatsApp message."
2. **Decide Next.js vs. staying on Vite** for `/p/:slug` before more pages
   or features depend on the current SPA routing — this determines whether
   shared listing links get proper WhatsApp/social link previews.
3. **Phase 5: pilot on your own Ludhiana listings** — per your own roadmap,
   this validates the soft-prompt conversion assumption before Phase 7
   (external paying tenants).
4. **RLS as defense-in-depth** (Ch.12.6) — recommended before onboarding
   any tenant that isn't Wayne E Solutions itself.
5. **Lead scoring** (Ch.11.3 — the weighted 0–100 "how warm is this" model)
   is fully specified in the docs but not implemented; nice-to-have once
   there's enough real lead volume to make sorting by it useful.

---

## Phase Roadmap (updated)

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Schema, auth, tenant setup | ✅ Done |
| Phase 1 | Geocoding, satellite image, public property page | ✅ Done |
| Phase 2 | Nearby landmarks, walk/drive times | ✅ Done |
| Phase 3 | Visit logging, soft phone prompt, lead feed | ✅ Done (this batch) |
| Phase 4 | WhatsApp chat CTA, personalised links | ✅ Done (this batch) |
| Phase 5 | BSP integration, automated first message | ⚠️ Code done and tested against a fake endpoint; needs a real BSP account to actually send |
| Phase 6 | Plot boundary tracer | ⚠️ UI hook + DB column ready; tracer itself still stubbed (unchanged, still backlog) |
| Phase 7 | First external tenants | ⏳ Blocked on RLS (Ch.12.6) and the internal pilot (Phase 5 above) |

Also still open: the frontend login flow is done, but there's no
password-reset or user-invite flow yet (Ch.12.5 mentions inviting
additional agents) — worth its own small task whenever a second dealer
user needs an account.

---

## Dev Credentials (seed only — unchanged)

| | |
|---|---|
| Email | admin@wayneesolutions.com |
| Password | Password123! |

**Change before any staging or production use.**
