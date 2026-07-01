/**
 * Phase 0: Foundations - Multi-Tenant Core Schema Initialization
 * Targets: PostgreSQL 14+ / Implements Explicit Tenant Isolation Key Constraints
 */

exports.up = async function(knex) {
  // 0. Enable UUID generation natively inside PostgreSQL extension layer
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // 1. TENANTS TABLE - The foundational root tenant matrix anchor
  await knex.schema.createTable('tenants', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.string('business_name', 255).notNullable();
    table.string('plan', 50).notNullable().defaultTo('starter'); // 'starter', 'growth', 'unlimited'
    table.string('whatsapp_mode', 50).notNullable().defaultTo('shared'); // 'shared' or 'dedicated'
    table.string('status', 50).notNullable().defaultTo('active'); // 'active', 'suspended', 'churned'
    table.timestamps(true, true); // Adds created_at and updated_at matching standard TIMESTAMPTZ
  });

  // 2. USERS TABLE - Backoffice dealer staff logins bound to specific tenants
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id')
         .notNullable()
         .references('id')
         .inTable('tenants')
         .onDelete('CASCADE'); // Strict cascade to keep data sanitized if a tenant is fully purged
    
    table.string('name', 255).notNullable();
    table.string('email', 255).notNullable().unique(); // Global enforcement to protect portal authentication
    table.string('password_hash', 255).notNullable(); // Stores salted bcrypt hashes securely
    table.string('role', 50).notNullable().defaultTo('agent'); // 'owner', 'agent'
    table.timestamps(true, true);

    // Compound performance indexing for authentication scoping
    table.index(['tenant_id', 'email'], 'idx_users_tenant_auth');
  });

  // 3. SYSTEM CONFIGS TABLE - Multi-tenant system limits, third-party operational credentials, and metadata
  await knex.schema.createTable('tenant_configs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id')
         .notNullable()
         .unique() // 1:1 Configuration mapping per tenant block
         .references('id')
         .inTable('tenants')
         .onDelete('CASCADE');

    table.string('google_maps_api_key_override', 255).nullable(); // Allows dedicated keys for higher volume plans
    table.string('bsp_provider_type', 50).notNullable().defaultTo('shared_gateway'); // e.g., 'getgabs', 'chat_mitra'
    table.string('bsp_auth_token', 500).nullable(); // Encryption-ready payload slot for external APIs
    table.jsonb('custom_branding_meta').nullable(); // Holds dashboard color schemas, logos, or localized text parameters
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  // Gracefully drop relations in reverse sequential dependency order
  await knex.schema.dropTableIfExists('tenant_configs');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('tenants');
};