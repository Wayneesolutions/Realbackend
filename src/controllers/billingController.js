const { v4: uuidv4 } = require('uuid');
const {
  listPlans,
  createCheckoutSession,
  constructStripeEvent,
  PLAN_PRICES_INR,
} = require('../services/billingService');
const { sendPaymentReceiptEmail } = require('../services/emailService');

const BILLING_PERIOD_DAYS = 30;

/**
 * GET /api/v1/public/billing/plans
 * Public — powers both the landing page pricing table and the billing modal.
 */
async function getPlans(req, res) {
  return res.json({ success: true, plans: listPlans() });
}

/**
 * POST /api/v1/dashboard/billing/create-checkout-session
 * Owner-only. Creates a Stripe Checkout Session and returns the hosted URL.
 * Frontend redirects the user to that URL to complete payment on Stripe.
 */
async function createCheckoutSessionHandler(req, res) {
  const knex = req.app.get('db');
  const { plan, successUrl, cancelUrl } = req.body;

  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the account owner can manage billing.' } });
  }

  if (!PLAN_PRICES_INR[plan]) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `plan must be one of: ${Object.keys(PLAN_PRICES_INR).join(', ')}.` },
    });
  }

  if (!successUrl || !cancelUrl) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'successUrl and cancelUrl are required.' },
    });
  }

  try {
    const paymentEventId = uuidv4();

    const owner = await knex('users').where({ tenant_id: req.user.tenant_id, role: 'owner' }).first();

    const { sessionId, url, amountPaise } = await createCheckoutSession({
      plan,
      paymentEventId,
      userEmail: owner?.email || req.user.email,
      successUrl,
      cancelUrl,
    });

    await knex('payment_events').insert({
      id: paymentEventId,
      tenant_id: req.user.tenant_id,
      stripe_session_id: sessionId,
      plan,
      amount_paise: amountPaise,
      status: 'created',
    });

    return res.status(201).json({ success: true, url });
  } catch (error) {
    console.error('Failed to create Stripe checkout session:', error.message);
    return res.status(500).json({ error: { code: 'CHECKOUT_CREATE_FAILED', message: 'Failed to start payment. Please try again.' } });
  }
}

/**
 * GET /api/v1/dashboard/billing/status
 * Any authenticated dashboard user can view billing status.
 */
async function getBillingStatus(req, res) {
  const knex = req.app.get('db');

  try {
    const tenant = await knex('tenants')
      .select('plan', 'subscription_status', 'current_period_end')
      .where({ id: req.user.tenant_id })
      .first();

    const history = await knex('payment_events')
      .select('plan', 'amount_paise', 'status', 'created_at')
      .where({ tenant_id: req.user.tenant_id, status: 'paid' })
      .orderBy('created_at', 'desc')
      .limit(5);

    return res.json({ success: true, billing: tenant, history });
  } catch (error) {
    console.error('Failed to fetch billing status:', error.message);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch billing status.' } });
  }
}

/**
 * POST /api/v1/webhooks/stripe
 * Public — signature-verified via STRIPE_WEBHOOK_SECRET.
 * Authoritative payment confirmation. Handles checkout.session.completed.
 */
async function handleStripeWebhook(req, res) {
  const knex = req.app.get('db');
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = constructStripeEvent(req.rawBody, sig);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  // If STRIPE_WEBHOOK_SECRET not set, parse body directly (dev mode only)
  if (!event) {
    event = req.body;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const paymentEventId = session.metadata?.payment_event_id;

      if (paymentEventId) {
        const paymentEvent = await knex('payment_events').where({ id: paymentEventId }).first();
        if (paymentEvent && paymentEvent.status !== 'paid') {
          await markPaymentPaid(knex, paymentEvent, session.payment_intent, event);
        }
      }
    }

    // Always 200 — Stripe retries on non-2xx.
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Failed to process Stripe webhook:', error.message);
    return res.status(200).json({ received: true, trackingError: error.message });
  }
}

/**
 * Marks a payment event as paid, extends the tenant's subscription, and
 * sends the receipt email. Idempotent — safe to call twice.
 */
async function markPaymentPaid(knex, paymentEvent, stripePaymentIntentId, rawWebhookPayload = null) {
  if (paymentEvent.status === 'paid') {
    const tenant = await knex('tenants').where({ id: paymentEvent.tenant_id }).first();
    return { plan: tenant.plan, subscription_status: tenant.subscription_status, current_period_end: tenant.current_period_end };
  }

  const newPeriodEnd = new Date(Date.now() + BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  let tenant;

  await knex.transaction(async (trx) => {
    await trx('payment_events')
      .where({ id: paymentEvent.id })
      .update({
        status: 'paid',
        stripe_payment_intent_id: stripePaymentIntentId || null,
        raw_webhook_payload: rawWebhookPayload ? JSON.stringify(rawWebhookPayload) : null,
        updated_at: trx.fn.now(),
      });

    [tenant] = await trx('tenants')
      .where({ id: paymentEvent.tenant_id })
      .update({
        plan: paymentEvent.plan,
        subscription_status: 'active',
        current_period_end: newPeriodEnd,
        updated_at: trx.fn.now(),
      })
      .returning(['id', 'business_name', 'plan', 'subscription_status', 'current_period_end']);

    const owner = await trx('users').where({ tenant_id: tenant.id, role: 'owner' }).first();
    if (owner) {
      sendPaymentReceiptEmail({
        to: owner.email,
        businessName: tenant.business_name,
        plan: paymentEvent.plan,
        amountINR: paymentEvent.amount_paise / 100,
        currentPeriodEnd: newPeriodEnd,
      }).catch((err) => console.error('Payment receipt email failed (non-fatal):', err.message));
    }
  });

  return { plan: tenant.plan, subscription_status: tenant.subscription_status, current_period_end: tenant.current_period_end };
}

module.exports = { getPlans, createCheckoutSessionHandler, getBillingStatus, handleStripeWebhook };
