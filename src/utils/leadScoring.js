/**
 * Computes a 0-100 lead score from behavioral signals (Ch.11.3 of the Tech
 * Stack doc). Computed at read time rather than cached — revisit once lead
 * volume is high enough that per-request computation gets expensive.
 *
 * @param {string} leadId
 * @param {import('knex').Knex} knex
 * @returns {Promise<number>}
 */
async function computeLeadScore(leadId, knex) {
  let score = 0;

  try {
    // Signal 1: phone shared — every row in `leads` has a phone by definition
    const lead = await knex('leads').where({ id: leadId }).first();
    if (lead?.phone) score += 35;

    // Signals 2 & 3: repeat visits / distinct listings
    const visits = await knex('listing_visits')
      .where({ lead_id: leadId })
      .select('listing_id', 'visited_at');

    if (visits.length > 0) {
      const visitCountsByListing = {};
      visits.forEach((v) => {
        visitCountsByListing[v.listing_id] = (visitCountsByListing[v.listing_id] || 0) + 1;
      });

      let repeatVisitPoints = 0;
      Object.values(visitCountsByListing).forEach((count) => {
        if (count > 1) repeatVisitPoints += (count - 1) * 15;
      });
      score += Math.min(repeatVisitPoints, 30);

      const distinctListings = new Set(visits.map((v) => v.listing_id));
      if (distinctListings.size >= 3) score += 10;
    }

    // Signal 4: replied WITHIN the 24hr service window — not just "ever replied".
    // Gemini's version fetched service_window_expires_at but never actually
    // compared it against anything; fixed here to do the real comparison.
    const threads = await knex('whatsapp_threads')
      .where({ lead_id: leadId })
      .select('id', 'service_window_expires_at', 'created_at');

    let repliedWithinWindow = false;

    if (threads.length > 0) {
      for (const thread of threads) {
        const inboundInWindow = await knex('whatsapp_messages')
          .where({ thread_id: thread.id, direction: 'inbound', sender_type: 'visitor' })
          .andWhere('sent_at', '<=', thread.service_window_expires_at || thread.created_at)
          .first();

        if (inboundInWindow) {
          repliedWithinWindow = true;
          break;
        }
      }
    }

    if (repliedWithinWindow) score += 20;

    // Signal 5: stale visit (14+ days) with no reply at all
    const hasAnyReply = threads.length > 0 && await knex('whatsapp_messages')
      .whereIn('thread_id', threads.map((t) => t.id))
      .andWhere({ direction: 'inbound', sender_type: 'visitor' })
      .first();

    if (visits.length > 0 && !hasAnyReply) {
      const latestVisitTime = Math.max(...visits.map((v) => new Date(v.visited_at).getTime()));
      const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      if (latestVisitTime < fourteenDaysAgo) score -= 20;
    }

    return Math.max(0, Math.min(100, score));

  } catch (error) {
    console.error(`Failed to compute lead score for ${leadId}:`, error.message);
    return 35; // baseline rather than crashing the analytics request
  }
}

module.exports = { computeLeadScore };
