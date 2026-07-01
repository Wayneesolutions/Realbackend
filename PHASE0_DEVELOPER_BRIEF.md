# Property Visual Explorer — Phase 0 Developer Brief

**Product:** Property Visual Explorer
**Client:** Pankaj — Wayne E Solutions
**Phase:** 0 — Foundations

---

## What Phase 0 Delivers

A running Node.js/Express API with:
- Multi-tenant PostgreSQL schema (tenants, users, tenant_configs)
- JWT dealer login with bcrypt password verification
- Auth guard middleware protecting all dashboard routes
- Protected route: POST /api/v1/dashboard/listings
- Knex migrations + seed data (Wayne E Solutions tenant + admin login)

---

## Folder Structure

```
property-visual-explorer/
├── src/
│   ├── server.js                          # Entry point
│   ├── app.js                             # Express app + route mounting
│   ├── controllers/
│   │   ├── authController.js              # login()
│   │   └── listingController.js           # createListing()
│   ├── middleware/
│   │   ├── auth.js                        # JWT guard
│   │   └── tenantContext.js               # Tenant resolver
│   └── routes/
│       ├── auth.js                        # POST /api/v1/auth/login
│       ├── dashboard.js                   # POST /api/v1/dashboard/listings
│       └── public.js                      # Placeholder for Phase 1
├── migrations/
│   └── 20260628_01_phase0_foundation.js   # Creates tables
├── seeds/
│   └── 01_phase0_seed.js                  # Seeds Wayne E tenant + admin
├── package.json
├── knexfile.js
└── .env.example
```

---

## Setup Instructions

### Prerequisites
- Node.js v24+ (installed)
- PostgreSQL running locally
- Redis running locally

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Setup environment
copy .env.example .env
# Edit .env — fill in DB_PASSWORD and JWT_SECRET

# 3. Create the database (in psql or pgAdmin)
CREATE DATABASE property_visual_explorer_dev;

# 4. Run migrations
npm run migrate

# 5. Run seed
npm run seed

# 6. Start dev server
npm run dev
```

---

## API Testing

```bash
# Health check
GET http://localhost:3001/health

# Login
POST http://localhost:3001/api/v1/auth/login
{ "email": "admin@wayneesolutions.com", "password": "Password123!" }

# Create listing (use token from login)
POST http://localhost:3001/api/v1/dashboard/listings
Authorization: Bearer <token>
{
  "title": "Plot - Sarabha Nagar",
  "raw_address": "Sarabha Nagar, Ludhiana, Punjab",
  "price": 4500000,
  "plot_area": "200 sq yards",
  "property_type": "residential_plot"
}
```

---

## Known Bugs to Fix in Phase 1

1. `tenantContext.js` — path check `req.path.startsWith('/api/v1/public/')` never matches when used as sub-router. Fix: change to `/listings/`
2. `PropertyView.jsx` — hardcoded `key=YOUR_KEY` in Google Maps URL — must use env var
3. `publicListingController.js` — `lead_tag` used as `lead_id` in visit insert (wrong)

---

## Phase Roadmap

| Phase | Scope |
|-------|-------|
| **Phase 0** | Schema, auth, tenant setup — THIS PACKAGE |
| Phase 1 | Geocoding, satellite image, public property page |
| Phase 2 | Nearby landmarks, walk/drive times |
| Phase 3 | Visit logging, soft phone prompt, lead feed |
| Phase 4 | WhatsApp chat CTA, personalised links |
| Phase 5 | BSP integration, automated first message |
| Phase 6 | Plot boundary tracer (backlog) |

---

## Dev Credentials (seed only)

| | |
|---|---|
| Email | admin@wayneesolutions.com |
| Password | Password123! |

**Change before any staging or production use.**
