// src/middleware/tenantContext.js
//
// NOTE: not currently wired into any route (public.js and dashboard.js
// resolve tenant scope themselves — see publicListingController.js /
// authGuard). Kept for a future pass toward centralised enforcement per
// the Multi-tenancy doc (Ch.12.2), fixed here so it doesn't crash if wired
// in later: `db` (set in server.js) is a Knex instance, not a raw `pg`
// Pool, so it has no `.query(text, params)` method — use knex.raw instead.

/**
 * Middleware to enforce multi-tenancy context parsing
 * Resolves tenant_id via auth token OR public listing slug bypasses
 */
module.exports = async function tenantContext(req, res, next) {
  // 1. Authenticated Route Path (Dealers/Agents)
  if (req.user && req.user.tenant_id) {
    req.tenantId = req.user.tenant_id;
    return next();
  }

  // 2. Public Buyer Route Path (Resolved via listing slug)
  // Check if it's a public route containing a public_slug parameter.
  // FIX (was Phase 0 known bug #1): req.path inside a mounted sub-router
  // never includes the mount prefix ('/api/v1/public'), so that prefix is
  // stripped here. Once public.js gains a real GET /listings/:slug route,
  // this check will correctly match it.
  const { slug } = req.params;
  if (req.path.startsWith('/listings/') && slug) {
    try {
      const knex = req.app.get('db'); // Knex instance (see server.js) — not a raw pg Pool
      const listing = await knex('listings')
        .select('tenant_id')
        .where({ public_slug: slug, status: 'active' })
        .first();

      if (!listing) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Property listing not found or inactive.' }
        });
      }

      req.tenantId = listing.tenant_id;
      return next();
    } catch (error) {
      console.error('Tenant scoping error via slug:', error);
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Context isolation failure.' } });
    }
  }

  // 3. Fallback Block - If a route is tenant-scoped but misses parameters
  if (req.path.startsWith('/api/v1/protected')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Tenant context could not be resolved.' } });
  }

  next();
};