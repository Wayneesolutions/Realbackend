# Property Visual Explorer — Phase 1 Developer Brief

**Product:** Property Visual Explorer
**Client:** Pankaj — Wayne E Solutions
**Phase:** 1 — Geo-Enrichment, Landmarks, Analytics & AI Reply (see scope note below)

---

## Read this first: scope note

The original roadmap (see `PHASE0_DEVELOPER_BRIEF.md`) defined Phase 1 narrowly as
*"geocoding, satellite image, public property page."* The code delivered in this
batch covers that **plus** several things from later phases — nearby landmarks
(originally Phase 2), lead/visit analytics (originally Phase 3), and an
automated AI WhatsApp reply worker + plot-tracer UI hook (Phase 5/6 territory).

That's not a problem — more working code is good — but it means **the
buyer-facing public property page itself (the actual headline Phase 1 deliverable)
was not included in this batch.** See "What's still missing" below before
calling Phase 1 done.

---

## What This Package Delivers

- **Geo-enrichment worker** — geocodes a listing's address via Google Geocoding,
  saves coordinates + a cached satellite/street-view image, flips the listing
  from `pending` → `active`.
- **Landmark worker** — automatically triggered after geocoding; finds nearby
  schools/hospitals/markets/transit via Google Places and caches walk/drive
  estimates.
- **VoCallM AI reply worker** — given a lead's incoming WhatsApp question,
  builds a property-grounded prompt and drafts a reply via OpenAI, then queues
  it for outbound delivery.
- **Dashboard analytics endpoint** — `GET /api/v1/dashboard/analytics`, returning
  KPI totals, per-listing performance, and a recent-leads feed.
- **Dashboard listings UI** (`DashboardListings.jsx`) — lists a tenant's
  properties, lets a dealer add a new one, and links out to a (stubbed) plot
  boundary tracer.
- **New database tables**: `listings`, `listing_media`, `listing_landmarks`,
  `leads`, `listing_visits`, `whatsapp_threads`, `whatsapp_messages`.

## What I Added to Make the Above Actually Run

The code as received had a few gaps that would have caused it to fail
immediately. These were added during integration, not present in the original
files you provided:

| Gap | Fix |
|---|---|
| `DashboardListings.jsx` calls `GET /api/v1/dashboard/listings`, but no such endpoint existed | Added `getListings()` in `listingController.js` + route in `dashboard.js` |
| `geoEnrichmentWorker.js` never actually triggered the landmark worker | Merged the separately-provided "append this to the top of geoEnrichmentWorker.js" snippet into the right place (after the transaction commits) |
| `DashboardListings.jsx` imports `./PlotBoundaryTracer`, which doesn't exist anywhere in Phase 0 or this batch | Added a clearly-labeled stub component so the app doesn't crash on import |
| No `listings`/`listing_media`/`listing_landmarks`/`leads`/`listing_visits`/`whatsapp_threads`/`whatsapp_messages` tables existed yet | Added `migrations/20260629_01_phase1_listings_and_engagement.js` |
| `package.json` was missing `axios`, `ioredis`, `mapbox-gl`, `@mapbox/mapbox-gl-draw` | Added to `dependencies` |
| `.env.example` was missing `MAPBOX_ACCESS_TOKEN`, `OPENAI_API_KEY` | Added |
| Worker run instructions used `&` to background processes, which doesn't work in Windows `cmd.exe` | Added `concurrently` + an `npm run workers` script that works on any OS |

## Phase 0 Known Bug — Fixed

`tenantContext.js` bug #1 (path check never matches inside a mounted sub-router)
is fixed. Bugs #2 and #3 from the Phase 0 brief reference files
(`PropertyView.jsx`, `publicListingController.js`) that still don't exist in
any batch delivered so far — see below.

---

## What's Still Missing (needed before Phase 1 is actually "done")

1. **The public buyer-facing property page itself** — no `GET /api/v1/public/listings/:slug`
   route or controller, and no `PropertyView.jsx` frontend page exist yet, in
   Phase 0 or this batch. This was the original headline goal of Phase 1. Ask
   your AI tool specifically for: a public listing controller (tenant resolved
   via the already-fixed `tenantContext.js`), its route, and a buyer-facing
   React page that renders the satellite/street-view image and price.
2. **Real plot boundary tracing** — `PlotBoundaryTracer.jsx` is a placeholder
   only. The `listing_media.plot_boundary_geojson` column is ready for it
   whenever it's built (this is Phase 6 scope, so not urgent).
3. **WhatsApp outbound delivery worker** — `vocallmWorker.js` queues a drafted
   reply onto a `whatsapp-outbound` queue, but no worker consumes that queue
   and actually sends it via your BSP yet.
4. **No frontend build setup** — `DashboardListings.jsx` and
   `PlotBoundaryTracer.jsx` are plain React component files. There's no
   Vite/CRA/Next.js project shell included to actually run them yet.

---

## Folder Structure

```
property-visual-explorer/
├── src/
│   ├── server.js
│   ├── app.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── listingController.js          # createListing() + getListings() [new]
│   │   └── analyticsController.js        # getDashboardAnalytics() [new]
│   ├── middleware/
│   │   ├── auth.js
│   │   └── tenantContext.js              # bug fixed [updated]
│   ├── routes/
│   │   ├── auth.js
│   │   ├── dashboard.js                  # +GET /listings, +GET /analytics [updated]
│   │   └── public.js                     # still a placeholder — see gap #1 above
│   └── workers/                          # [new]
│       ├── geoEnrichmentWorker.js        # now also triggers landmarkWorker
│       ├── landmarkWorker.js
│       └── vocallmWorker.js
├── client/src/components/                # [new] — no project shell yet, see gap #4
│   ├── DashboardListings.jsx
│   └── PlotBoundaryTracer.jsx            # stub — see gap #2
├── migrations/
│   ├── 20260628_01_phase0_foundation.js
│   └── 20260629_01_phase1_listings_and_engagement.js   # [new]
├── seeds/
│   └── 01_phase0_seed.js
├── package.json                          # deps + worker scripts added
├── knexfile.js
├── .env.example                          # Mapbox + OpenAI keys added
├── PHASE0_DEVELOPER_BRIEF.md
└── PHASE1_DEVELOPER_BRIEF.md              # this file
```

---

## Setup Instructions

If you already set up Phase 0, you only need the new steps marked **[NEW]**.

```bash
# 1. Install dependencies (now includes axios, ioredis, mapbox-gl, concurrently, etc.)
npm install                                            # [NEW deps]

# 2. Update your .env — copy the new lines from .env.example into your real .env:
#      MAPBOX_ACCESS_TOKEN=...
#      OPENAI_API_KEY=...

# 3. Run the new migration (adds listings, leads, visits, landmarks, whatsapp tables)
npm run migrate                                         # [NEW migration]

# 4. Start the API (same as Phase 0)
npm run dev

# 5. Start all three background workers in ONE command (new, cross-platform):
npm run workers

#    — or run them separately if you want to watch each one's logs on its own:
npm run worker:geo
npm run worker:landmark
npm run worker:vocallm
```

You'll need Redis running locally (same as Phase 0) for the workers to connect to.

---

## API Testing

```bash
# Create a listing (same as Phase 0) — this now actually triggers geocoding,
# which in turn triggers landmark lookup, because both workers are running.
POST http://localhost:3001/api/v1/dashboard/listings
Authorization: Bearer <token from /auth/login>
{
  "title": "Plot - Sarabha Nagar",
  "raw_address": "Sarabha Nagar, Ludhiana, Punjab",
  "price": 4500000,
  "plot_area": "200 sq yards",
  "property_type": "residential_plot"
}

# List your tenant's properties (new endpoint)
GET http://localhost:3001/api/v1/dashboard/listings
Authorization: Bearer <token>

# Dashboard analytics (new endpoint)
GET http://localhost:3001/api/v1/dashboard/analytics
Authorization: Bearer <token>
```

A few seconds after creating a listing, check `GET /listings` again — `status`
should flip from `pending` to `active`, and a follow-up query against
`listing_landmarks` (e.g. in psql: `SELECT * FROM listing_landmarks;`) should
show nearby places once the landmark worker has run.

---

## Phase Roadmap (updated)

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | Schema, auth, tenant setup | ✅ Done |
| Phase 1 | Geocoding, satellite image, **public property page** | ⚠️ Geocoding/media done; public page still missing (gap #1) |
| Phase 2 | Nearby landmarks, walk/drive times | ✅ Done (delivered early, in this batch) |
| Phase 3 | Visit logging, soft phone prompt, lead feed | ⚠️ Tables + analytics done; capture flow not built |
| Phase 4 | WhatsApp chat CTA, personalised links | ⏳ Not started |
| Phase 5 | BSP integration, automated first message | ⚠️ AI drafting done (vocallmWorker); outbound delivery not built |
| Phase 6 | Plot boundary tracer | ⚠️ UI hook + DB column ready; tracer itself stubbed |

---

## Dev Credentials (seed only — unchanged from Phase 0)

| | |
|---|---|
| Email | admin@wayneesolutions.com |
| Password | Password123! |

**Change before any staging or production use.**
