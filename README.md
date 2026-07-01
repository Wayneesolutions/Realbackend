# Property Visual Explorer — Backend

API + background workers for Property Visual Explorer (Wayne E Solutions).

**This is the backend only.** The frontend lives in a separate repo —
`property-visual-explorer-frontend`. Full product/technical spec is in
`Property_Visual_Explorer_Documentation_Suite.docx` (kept wherever your
other internal docs live, not in this repo).

Status: Phases 0–4 complete. See `PHASE4_DEVELOPER_BRIEF.md` for the most
recent batch and "What to Build Next." Earlier phases: `PHASE0` through
`PHASE3_DEVELOPER_BRIEF.md`.

## Stack

Node.js/Express · PostgreSQL (Knex) · Redis + BullMQ · Google Maps
Platform · OpenAI · WhatsApp BSP (bring your own provider).

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis
- Google Maps Platform API key (Geocoding, Places, Static Maps)
- OpenAI API key
- A WhatsApp BSP account (Chat Mitra, Getgabs, or similar) — only needed to actually send messages; everything else works without it

## Setup

```bash
npm install
cp .env.example .env
# edit .env — at minimum: DB_PASSWORD, JWT_SECRET, GOOGLE_MAPS_API_KEY

createdb property_visual_explorer_dev   # must match .env DB_NAME

npm run migrate
npm run seed
```

## Running locally

```bash
npm run dev        # API server — http://localhost:3001
npm run workers     # all 4 background workers (geo, landmark, vocallm, whatsapp)
```

Redis and Postgres must already be running.

| | |
|---|---|
| Seed login email | admin@wayneesolutions.com |
| Seed login password | Password123! |

**Change these before any staging/production deployment.**

## Deploying separately from the frontend (AWS or otherwise)

The frontend and backend are two independent repos/deployments now. Two
env vars matter specifically because of that split:

- **`CORS_ORIGIN`** — set this to the frontend's real deployed URL (e.g.
  `https://app.yourdomain.com`). Left blank, the API accepts requests from
  any origin — fine for local dev, not for production.
- The frontend needs to know this backend's URL via its own
  `VITE_API_BASE_URL` — see the frontend repo's README.

Nothing else about splitting the deployments requires backend code
changes; the API doesn't care where the frontend is hosted, as long as
CORS is configured to allow it.

## Project layout

```
src/
  controllers/     # route handlers
  middleware/       # JWT auth guard, tenant context
  routes/           # auth.js, dashboard.js (protected), public.js, webhooks.js
  workers/          # BullMQ workers: geo-enrichment, landmarks, VoCallM AI reply, WhatsApp outbound
  utils/            # phone normalization, lead scoring
migrations/         # Knex migrations, run in order
seeds/              # dev seed data
```

## Known open items

- **RLS (Row-Level Security)** — not yet added; see `PHASE4_DEVELOPER_BRIEF.md`
  for why it needs a proper transaction-per-request refactor rather than a
  drop-in middleware. Recommended before onboarding any tenant outside
  Wayne E Solutions.
- **Webhook tenant resolution** — the inbound WhatsApp webhook currently
  falls back to "the oldest active tenant" for unrecognized phone numbers.
  Fine with one tenant; needs the BSP's "to" number wired in before a
  second tenant exists.
