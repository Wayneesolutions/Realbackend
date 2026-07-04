const crypto = require('crypto');
const { Queue } = require('bullmq');

const redisConnection = { host: process.env.REDIS_HOST || '127.0.0.1', port: process.env.REDIS_PORT || 6379 };
const vocallmChatQueue = new Queue('vocallm-chat-processor', { connection: redisConnection });

/**
 * Normalizes incoming BSP payloads into a single shape. Edit this isolated
 * helper when swapping between Chat Mitra, Getgabs, or Meta Cloud API —
 * nothing else in this file should need to change.
 */
function parseInboundPayload(body) {
  return {
    phone: body.contacts?.[0]?.wa_id || body.from_phone || body.sender?.phone,
    leadName: body.contacts?.[0]?.profile?.name || body.from_name || body.sender?.name || 'Visitor',
    incomingText: body.messages?.[0]?.text?.body || body.message_text || body.text,
    bspThreadRef: body.messages?.[0]?.id || body.conversation_id || body.msg_id,
    inferredSlug: body.messages?.[0]?.context?.referred_slug || body.metadata?.slug || null,
    // The receiving WhatsApp business number — most BSPs include this so we
    // can route messages to the correct tenant without relying on "oldest active".
    receivingNumber: body.metadata?.phone_number_id
      ? null // Meta Cloud API uses phone_number_id, not a raw number — resolve below if needed
      : body.to || body.to_phone || body.receiver?.phone || null,
  };
}

/**
 * Verifies the BSP's HMAC signature against the RAW request body bytes —
 * not JSON.stringify(req.body). Re-stringifying an already-parsed object
 * doesn't reliably reproduce the exact bytes the sender signed (key order,
 * whitespace, unicode escaping can all differ), so that comparison would
 * fail even for a legitimate request. This requires `req.rawBody` to be
 * captured by express.json()'s `verify` option — see app.js.
 */
function isValidSignature(req, secret) {
  const signature = req.headers['x-hub-signature-256'] || req.headers['x-bsp-signature'];
  if (!secret || !signature) return true; // no secret configured yet — nothing to check against
  if (!req.rawBody) return false; // can't verify without the raw bytes

  const digest = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const provided = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(provided));
  } catch {
    return false; // length mismatch etc. — treat as invalid, not a crash
  }
}

/**
 * Core webhook handler — fast ack, log the inbound message, hand off to
 * BullMQ. Does not wait on the AI reply.
 */
async function handleInboundWhatsApp(req, res) {
  const knex = req.app.get('db');
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (!isValidSignature(req, secret)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature.' } });
  }

  const { phone, leadName, incomingText, bspThreadRef, inferredSlug, receivingNumber } = parseInboundPayload(req.body);

  if (!phone || !incomingText) {
    // Non-message events (delivery receipts, status updates) — ack and move on
    return res.status(200).json({ success: true, warning: 'Acknowledged non-message event.' });
  }

  try {
    const resolvedContext = await knex.transaction(async (trx) => {
      let thread = bspThreadRef
        ? await trx('whatsapp_threads').where({ bsp_thread_ref: bspThreadRef }).first()
        : null;

      let lead;
      let listing;

      if (thread) {
        lead = await trx('leads').where({ id: thread.lead_id }).first();
        listing = thread.listing_id
          ? await trx('listings').where({ id: thread.listing_id }).first()
          : null;
      } else {
        lead = await trx('leads').where({ phone }).first();

        if (!lead) {
          // Resolve tenant by the receiving WhatsApp number when the BSP
          // includes it (most do — Gupshup/Interakt/Meta Cloud API all send
          // a "to" or equivalent field). Falls back to the shared-number
          // path (oldest active tenant) only when receivingNumber is absent,
          // which means it arrived on the platform's shared number where the
          // inferredSlug-based lookup already disambiguates by property.
          let defaultTenant = null;

          if (receivingNumber) {
            defaultTenant = await trx('tenants')
              .where({ whatsapp_number: receivingNumber, status: 'active' })
              .first();
          }

          if (!defaultTenant) {
            // Shared-number fallback: safe only when one tenant uses the
            // shared number. The inferredSlug path below further narrows it.
            defaultTenant = await trx('tenants')
              .where({ status: 'active' })
              .orderBy('created_at', 'asc')
              .first();
          }

          if (!defaultTenant) throw new Error('No active tenant found to attribute this message to.');

          if (inferredSlug) {
            listing = await trx('listings').where({ public_slug: inferredSlug, status: 'active' }).first();
          }
          if (!listing) {
            listing = await trx('listings')
              .where({ tenant_id: defaultTenant.id, status: 'active' })
              .orderBy('created_at', 'desc')
              .first();
          }

          const [newLead] = await trx('leads').insert({
            tenant_id: defaultTenant.id,
            name: leadName,
            phone,
            source: 'whatsapp_inbound',
            status: 'new'
          }).returning(['id', 'tenant_id']);

          lead = newLead;
        } else if (!listing) {
          listing = await trx('listings')
            .where({ tenant_id: lead.tenant_id, status: 'active' })
            .orderBy('created_at', 'desc')
            .first();
        }

        if (!listing) throw new Error('No listing context available to attribute this conversation to.');

        // Reuse an existing open thread for this lead+listing if one exists —
        // without this check, a lead whose earlier thread has no
        // bsp_thread_ref (e.g. one opened via the public-page phone prompt,
        // not a prior inbound message) gets a duplicate thread every time.
        thread = await trx('whatsapp_threads')
          .where({ tenant_id: lead.tenant_id, lead_id: lead.id, listing_id: listing.id, status: 'open' })
          .first();

        if (!thread) {
          const [newThread] = await trx('whatsapp_threads').insert({
            tenant_id: lead.tenant_id,
            lead_id: lead.id,
            listing_id: listing.id,
            bsp_thread_ref: bspThreadRef || `thread_${Date.now()}`,
            status: 'open',
            service_window_expires_at: knex.raw("NOW() + INTERVAL '24 hours'")
          }).returning(['id']);

          thread = newThread;
        } else if (bspThreadRef && !thread.bsp_thread_ref) {
          // Backfill the BSP ref so future messages in this conversation match directly
          await trx('whatsapp_threads').where({ id: thread.id }).update({ bsp_thread_ref: bspThreadRef });
        }
      }

      await trx('whatsapp_messages').insert({
        thread_id: thread.id,
        direction: 'inbound',
        sender_type: 'visitor',
        message_category: 'utility',
        body: incomingText.trim()
      });

      return {
        tenantId: lead.tenant_id,
        threadId: thread.id,
        leadId: lead.id,
        listingId: listing ? listing.id : thread.listing_id
      };
    });

    await vocallmChatQueue.add('process-chat-reply', {
      tenantId: resolvedContext.tenantId,
      threadId: resolvedContext.threadId,
      leadId: resolvedContext.leadId,
      listingId: resolvedContext.listingId,
      incomingText: incomingText.trim(),
      phone: phone.trim()
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Failed to process inbound WhatsApp webhook:', error.message);
    // Still ack 200 so the BSP doesn't retry-storm us; the error is logged server-side.
    return res.status(200).json({ success: true, trackingError: error.message });
  }
}

module.exports = { handleInboundWhatsApp, parseInboundPayload };
