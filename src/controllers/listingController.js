const crypto = require('crypto');
const { Queue } = require('bullmq');

// Initialize access queue pointing at our background Redis worker instance
const geoEnrichmentQueue = new Queue('geo-enrichment', {
  connection: { host: process.env.REDIS_HOST || '127.0.0.1', port: 6379 }
});

/**
 * Inserts a new real estate listing asset safely scoped inside the active tenant space.
 * Dispatches an asynchronous geocoding and visual aggregation job via BullMQ.
 */
async function createListing(req, res) {
  const knex = req.app.get('db');
  
  // Extract contextual identity injected previously by our authGuard middleware
  const { tenant_id, id: userId } = req.user;
  
  const { title, raw_address, price, plot_area, property_type, description } = req.body;

  // 1. Structural Parameter Validation Checks
  if (!title || !raw_address || !price || !property_type) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Title, raw address, price, and property type are required fields.' }
    });
  }

  try {
    // 2. Generate a highly secure, unguessable URL slug (16 random bytes to prevent guessing attacks)
    const publicSlug = crypto.randomBytes(16).toString('hex');

    // 3. Persist the database record wrapped inside our Knex client tracking system
    const [newListing] = await knex('listings')
      .insert({
        tenant_id,
        created_by: userId,
        title: title.trim(),
        raw_address: raw_address.trim(),
        price: parseFloat(price),
        plot_area: plot_area ? plot_area.trim() : null,
        property_type: property_type.trim(),
        description: description ? description.trim() : null,
        public_slug: publicSlug,
        status: 'pending' // Remains 'pending' until the background geocoder confirms coordinates
      })
      .returning(['id', 'title', 'public_slug', 'status']);

    // 4. Offload third-party Google Maps platform API latency to BullMQ task engine
    await geoEnrichmentQueue.add('enrich-property-coords', {
      listingId: newListing.id,
      rawAddress: raw_address.trim()
    }, {
      attempts: 3, // Automatically retry 3 times if Google API spikes or rate limits kick in
      backoff: {
        type: 'exponential',
        delay: 2000 // Start with 2 second backoff floor intervals
      }
    });

    // 5. Send transaction metadata back to the Dashboard UI right away
    return res.status(201).json({
      success: true,
      message: 'Base listing asset registered. Geo-enrichment pipeline triggered in the background.',
      listing: {
        id: newListing.id,
        title: newListing.title,
        publicLinkSlug: newListing.public_slug,
        status: newListing.status
      }
    });

  } catch (error) {
    console.error('Failed to instantiate new transactional property row:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'System failed to write property configuration.' }
    });
  }
}

/**
 * Lists every listing belonging to the current tenant, with a visit_count
 * computed for each — this is what DashboardListings.jsx (Phase 1 UI) calls.
 * Not part of the original Gemini code drop; added here because the UI
 * component depends on it and would otherwise have nothing to render.
 */
async function getListings(req, res) {
  const knex = req.app.get('db');
  const { tenant_id } = req.user;

  try {
    const listings = await knex('listings')
      .leftJoin('listing_visits', 'listings.id', 'listing_visits.listing_id')
      .select(
        'listings.id',
        'listings.title',
        'listings.raw_address',
        'listings.formatted_address',
        'listings.lat',
        'listings.lng',
        'listings.price',
        'listings.plot_area',
        'listings.property_type',
        'listings.description',
        'listings.status',
        'listings.public_slug',
        'listings.created_at'
      )
      .count('listing_visits.id as visit_count')
      .where('listings.tenant_id', tenant_id)
      .groupBy(
        'listings.id', 'listings.title', 'listings.raw_address', 'listings.formatted_address',
        'listings.lat', 'listings.lng', 'listings.price', 'listings.plot_area',
        'listings.property_type', 'listings.description', 'listings.status',
        'listings.public_slug', 'listings.created_at'
      )
      .orderBy('listings.created_at', 'desc');

    return res.status(200).json({
      success: true,
      listings: listings.map((l) => ({ ...l, visit_count: parseInt(l.visit_count || 0) }))
    });
  } catch (error) {
    console.error('Failed to fetch tenant listing inventory:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'System failed to load property inventory.' }
    });
  }
}

module.exports = { createListing, getListings };