/**
 * Phase 3: adds the tenant-level WhatsApp number referenced in the
 * Multi-tenancy Design Document (Ch.12.3 "WhatsApp Number Model") but never
 * actually migrated in Phase 0. Nullable — a tenant on shared mode leaves
 * this empty and the app falls back to WHATSAPP_SHARED_NUMBER from env.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('tenants', (table) => {
    table.string('whatsapp_number', 20).nullable(); // E.164, digits only after '+' — used to build wa.me links for dedicated-number tenants
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('whatsapp_number');
  });
};
