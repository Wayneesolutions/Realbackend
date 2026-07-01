# Property Visual Explorer — Phase 2 Developer Brief

**Product:** Property Visual Explorer
**Client:** Pankaj — Wayne E Solutions
**Phase:** 2 — Public Property Page + WhatsApp Outbound Delivery

---

## What This Package Delivers

- **The public property page** (the gap flagged at the end of the Phase 1 brief)
  is now built end to end: `GET /api/v1/public/listings/:slug` on the backend,
  and a real `PropertyView.jsx` page on the frontend that renders it.
- **A real frontend project** — `client/` is now an actual runnable Vite +
  React app (not just loose component files), with routing:
  `/dashboard` → `DashboardListings`, `/p/:slug` → `PropertyView`.
- **WhatsApp outbound delivery worker** — consumes the `whatsapp-outbound`
  queue (the one `vocallmWorker.js` already feeds), POSTs to your BSP gateway,
  and logs the sent message into `whatsapp_messages`.

## Issues Found and Fixed During Integration

| Issue | Fix |
|---|---|
| Gemini's `vite.config.js` proxied `/api` to port **5000**, but this project's backend has run on port **3001** since Phase 0 | Corrected the proxy target — without this, every API call from the frontend would have failed with "connection refused" |
| Gemini's new `public.js` route file would have **deleted** the existing `/ping` health-check route | Merged: kept `/ping`, added the new `/listings/:slug` route alongside it |
| Gemini regenerated the backend `package.json` from scratch **twice** (both incomplete — missing `bcrypt`, `jsonwebtoken`, `mapbox-gl` that earlier phases already added) | Did not use either regenerated file. Patched the existing `package.json` instead: just added the `worker:whatsapp` script. No new dependencies were actually needed — `axios`, `ioredis`, `bullmq`, `concurrently` were already added in Phase 1. |
| A `gemini-code-...sql` file said `CREATE DATABASE real_estate_explorer;` | **Don't run this.** This project's database has been `property_visual_explorer_dev` since Phase 0 (see `knexfile.js`). Gemini drifted off this name again, same as it did back in the very first Phase 0 setup files. |
| The folder-structure tree Gemini sent referenced `src/middleware/tenantIsolation.js` | That file was never actually delivered, and it isn't needed — `getPublicListing` is safe without tenant middleware because `public_slug` is globally unique and already implies exactly one tenant's listing. Not a gap, just a stale reference in the tree diagram. |

---

## ⚠️ Important Gap Found — Please Read Before Testing

**There is currently no way to actually log into the dashboard from the browser.**

`DashboardListings.jsx`'s code comment says it "assumes default headers handle
active JWT bearer attachments" — but nothing anywhere in any phase has actually
built a login page or set that header. The backend login endpoint
(`POST /api/v1/auth/login`) has worked since Phase 0, but there's no frontend
form that calls it and stores the resulting token.

**For now, to test the dashboard locally:** open your browser's dev tools
console on `localhost:3000` and run:

```js
const res = await fetch('http://localhost:3001/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@wayneesolutions.com', password: 'Password123!' })
});
const { token } = await res.json();
localStorage.setItem('token', token);
location.reload();
```

This is a manual workaround, not a real fix — a proper login page is the
single most important thing to build next (see "What to Build Next" below).

**Second related gap:** there's also no automatic flow yet that creates a
`leads` row or a `whatsapp_threads` row. `vocallmWorker.js` and the new
`whatsappOutboundWorker.js` both assume a `threadId` already exists — but
nothing creates one yet (that's Phase 4: "WhatsApp chat CTA, personalised
links," still not started). To test `whatsappOutboundWorker.js` right now,
you need to manually insert test data first:

```sql
-- Run in psql against property_visual_explorer_dev
INSERT INTO leads (id, tenant_id, name, phone, source, status)
VALUES (uuid_generate_v4(), 'e2b0a178-523c-4a37-bba2-58807d9f75a2', 'Test Lead', '+919999999999', 'soft_prompt', 'new')
RETURNING id;
-- copy the returned id, then:
INSERT INTO whatsapp_threads (id, tenant_id, lead_id, status)
VALUES (uuid_generate_v4(), 'e2b0a178-523c-4a37-bba2-58807d9f75a2', '<lead id from above>', 'open')
RETURNING id;
-- use that thread id when manually adding a test job to the whatsapp-outbound queue
```

---

## Folder Structure (changes from Phase 1 marked)

```
property-visual-explorer/
├── client/                                # [NEW] now a real Vite project
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js                     # proxy port fixed: 3001
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                        # routes: /dashboard, /p/:slug
│       └── components/
│           ├── DashboardListings.jsx       (from Phase 1)
│           ├── PlotBoundaryTracer.jsx      (stub, from Phase 1)
│           └── PropertyView.jsx           # [NEW] the actual public page
├── src/
│   ├── controllers/
│   │   ├── publicListingController.js     # [NEW] getPublicListing()
│   │   └── ...(authController, listingController, analyticsController unchanged)
│   ├── routes/
│   │   └── public.js                      # [UPDATED] merged, didn't overwrite /ping
│   └── workers/
│       └── whatsappOutboundWorker.js      # [NEW]
├── package.json                            # [UPDATED] +worker:whatsapp script only
└── (everything else unchanged from Phase 1)
```

---

## Setup Instructions

If you already have Phase 1 running, here's just what's new:

```bash
# 1. Backend — no new dependencies needed, but reinstall is harmless:
npm install

# 2. Frontend — set up the client project for the first time:
cd client
npm install
cd ..

# 3. Start the backend API (same as before)
npm run dev

# 4. Start all four workers in one command (geo, landmark, vocallm, whatsapp)
npm run workers

# 5. In a separate terminal, start the frontend:
cd client
npm run dev
```

Then open **http://localhost:3000/dashboard** — run the login workaround
above in the browser console first, or you'll just see a loading/error state.

To see the public property page, find a listing's `public_slug` (check the
database, or the response when you create a listing) and visit:
**http://localhost:3000/p/<that-slug>**

---

## API Testing

```bash
# Public listing page data (no auth needed) — note: port 3001, not 5000
curl http://localhost:3001/api/v1/public/listings/<an-active-slug>

# Expected success shape:
# { "success": true, "listing": {...}, "media": {...}, "landmarks": [...] }

# Expected error shape if the slug doesn't exist or isn't active:
# { "error": { "code": "NOT_FOUND", "message": "..." } }
```

---

## What to Build Next

In priority order:

1. **A real login page** (`client/src/components/Login.jsx`) that calls
   `POST /api/v1/auth/login`, stores the token (localStorage is fine for now),
   and attaches it to every dashboard API call. This unblocks actually using
   the dashboard without the console workaround above.
2. **Phase 4: WhatsApp chat CTA + lead capture** — the piece that actually
   creates `leads` and `whatsapp_threads` rows from a real buyer visit. Right
   now the whole WhatsApp pipeline (vocallm → outbound worker) works in
   isolation but has no real trigger.
3. **Visit logging + soft phone prompt** on `PropertyView.jsx` (Phase 3) —
   the public page currently doesn't log a visit or offer to capture a phone
   number at all.

---

## Phase Roadmap (updated)

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Schema, auth, tenant setup | ✅ Done |
| Phase 1 | Geocoding, satellite image, **public property page** | ✅ Done (public page completed this batch) |
| Phase 2 | Nearby landmarks, walk/drive times | ✅ Done |
| Phase 3 | Visit logging, soft phone prompt, lead feed | ⚠️ Tables + analytics done; capture flow not built |
| Phase 4 | WhatsApp chat CTA, personalised links | ⏳ Not started — see "What to Build Next" #2 |
| Phase 5 | BSP integration, automated first message | ✅ Done (AI drafting + outbound delivery both work, in isolation — see gap notes above) |
| Phase 6 | Plot boundary tracer | ⚠️ UI hook + DB column ready; tracer itself stubbed |

**Also still missing, not on the original phase list:** a frontend login flow
(see above) — worth treating as its own small task rather than folding into
any one phase.

---

## Dev Credentials (seed only — unchanged)

| | |
|---|---|
| Email | admin@wayneesolutions.com |
| Password | Password123! |

**Change before any staging or production use.**
