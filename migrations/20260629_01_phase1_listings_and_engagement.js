/**
 * Phase 1: Listings, Geo-Enrichment & Engagement Schema
 * Adds the tables that Phase 1 worker/controller code reads and writes.
 *
 * Note on scope: this migration goes slightly ahead of the original Phase 1
 * roadmap line ("geocoding, satellite image, public property page") because
 * the code delivered in this batch also touches landmarks (originally Phase 2)
 * and lead/visit analytics (originally Phase 3). Rather than splitting one
 * migration across phases, every table the current code depends on is created
 * here now. See PHASE1_DEVELOPER_BRIEF.md for the full breakdown.
 */

exports.up = async function (knex) {
  // 1. LISTINGS — one row per property
  await knex.schema.createTable('listings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id')
         .notNullable()
         .references('id')
         .inTable('tenants')
         .onDelete('CASCADE');
    table.uuid('created_by').references('id').inTable('users');

    table.string('title', 255).notNullable();
    table.text('raw_address').notNullable();
    table.text('formatted_address'); // filled in by geoEnrichmentWorker once geocoded
    table.decimal('lat', 10, 7);
    table.decimal('lng', 10, 7);
    table.decimal('price', 14, 2).notNullable();

    // NOTE: kept as a free-text string ("250 Sq Yards") to match the field
    // Phase 0's listingController.js and the dashboard UI already use.
    // The original schema doc modeled this as plot_area_sqft (DECIMAL) —
    // intentionally deviating here to stay consistent with shipped Phase 0 code.
    table.string('plot_area', 100);

    table.string('property_type', 50).notNullable(); // Plot / Villa / Commercial
    table.text('description');
    table.string('status', 20).notNullable().defaultTo('pending'); // pending -> active (set by geoEnrichmentWorker) / sold / inactive
    table.string('public_slug', 64).notNullable().unique();
    table.timestamps(true, true);

    table.index(['tenant_id'], 'idx_listings_tenant');
    table.index(['public_slug'], 'idx_listings_slug');
  });

  // 2. LISTING MEDIA — cached satellite / street view (1:1 with listings)
  await knex.schema.createTable('listing_media', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('listing_id')
         .notNullable()
         .unique()
         .references('id')
         .inTable('listings')
         .onDelete('CASCADE');
    table.text('satellite_image_url');
    table.text('streetview_image_url');
    table.text('aerial_view_video_url');
    table.jsonb('plot_boundary_geojson'); // populated by the Phase 6 plot tracer (UI scaffolded, not wired up yet)
    table.timestamp('fetched_at').defaultTo(knex.fn.now());
  });

  // 3. LISTING LANDMARKS — cached nearby places (Phase 2 scope, included now)
  await knex.schema.createTable('listing_landmarks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('listing_id')
         .notNullable()
         .references('id')
         .inTable('listings')
         .onDelete('CASCADE');
    table.string('place_name', 255);
    table.string('place_type', 50); // school / hospital / market / transit
    table.decimal('lat', 10, 7);
    table.decimal('lng', 10, 7);
    table.integer('walk_minutes');
    table.integer('drive_minutes');
    table.integer('distance_meters');
    table.timestamp('fetched_at').defaultTo(knex.fn.now());

    table.index(['listing_id'], 'idx_landmarks_listing');
  });

  // 4. LEADS — known contacts (Phase 3 scope, included now for analytics)
  await knex.schema.createTable('leads', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id')
         .notNullable()
         .references('id')
         .inTable('tenants')
         .onDelete('CASCADE');
    table.string('name', 255);
    table.string('phone', 20);
    table.string('email', 255);
    table.string('source', 50); // whatsapp_share / soft_prompt / ad / referral
    table.uuid('assigned_to').references('id').inTable('users');
    table.string('status', 20).notNullable().defaultTo('new'); // new / contacted / qualified / closed / lost
    table.timestamps(true, true);

    table.index(['tenant_id'], 'idx_leads_tenant');
    table.index(['phone'], 'idx_leads_phone');
  });

  // 5. LISTING VISITS — every page view (Phase 3 scope, included now for analytics)
  await knex.schema.createTable('listing_visits', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('listing_id')
         .notNullable()
         .references('id')
         .inTable('listings')
         .onDelete('CASCADE');
    table.uuid('lead_id').references('id').inTable('leads'); // null = anonymous visit
    table.string('referral_source', 50);
    table.string('referral_lead_tag', 100);
    table.timestamp('visited_at').defaultTo(knex.fn.now());
    table.text('user_agent');
    table.string('ip_city', 100); // coarse, city-level only — no precise device geolocation

    table.index(['listing_id'], 'idx_visits_listing');
    table.index(['lead_id'], 'idx_visits_lead');
    table.index(['visited_at'], 'idx_visits_time');
  });

  // 6. WHATSAPP THREADS — scaffolded for the upcoming BSP integration phase.
  // Not yet read/written by any code in this batch, but vocallmWorker.js
  // operates on a threadId, so the table is created now to avoid a later migration churn.
  await knex.schema.createTable('whatsapp_threads', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id')
         .notNullable()
         .references('id')
         .inTable('tenants')
         .onDelete('CASCADE');
    table.uuid('lead_id')
         .notNullable()
         .references('id')
         .inTable('leads')
         .onDelete('CASCADE');
    table.uuid('listing_id').references('id').inTable('listings');
    table.string('bsp_thread_ref', 255);
    table.string('status', 20).notNullable().defaultTo('open'); // open / closed / handed_to_agent
    table.timestamp('service_window_expires_at');
    table.timestamps(true, true);

    table.index(['tenant_id'], 'idx_wa_threads_tenant');
    table.index(['lead_id'], 'idx_wa_threads_lead');
  });

  // 7. WHATSAPP MESSAGES — same scaffolding rationale as whatsapp_threads above.
  await knex.schema.createTable('whatsapp_messages', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('thread_id')
         .notNullable()
         .references('id')
         .inTable('whatsapp_threads')
         .onDelete('CASCADE');
    table.string('direction', 10).notNullable(); // outbound / inbound
    table.string('sender_type', 20); // system_auto / agent / visitor / vocallm
    table.string('message_category', 20); // marketing / utility / authentication / service
    table.text('body');
    table.timestamp('sent_at').defaultTo(knex.fn.now());

    table.index(['thread_id'], 'idx_wa_messages_thread');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('whatsapp_messages');
  await knex.schema.dropTableIfExists('whatsapp_threads');
  await knex.schema.dropTableIfExists('listing_visits');
  await knex.schema.dropTableIfExists('leads');
  await knex.schema.dropTableIfExists('listing_landmarks');
  await knex.schema.dropTableIfExists('listing_media');
  await knex.schema.dropTableIfExists('listings');
};
