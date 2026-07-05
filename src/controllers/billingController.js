const {
  listPlans,
  createOrderForPlan,
  verifyPaymentSignature,
  verifyWebhookSignature,
  PLAN_PRICES_INR,
} = require('../services/billingService');
const { sendPaymentReceiptEmail } = require('../services/emailService');

const BILLING_PERIOD_DAYS = 30;

/**
 * GET /api/v1/public/billing/plans
 * Public — powers both the landing page pricing table and the dashboard
 * billing modal, so pricing only needs to change in one place
 * (billingService.js).
 */
async function getPlans(req, res) {
  return res.json({ success: true, plans: listPlans() });
}

/**
 * POST /api/v1/dashboard/billing/create-order
 * Owner-only. Creates a Razorpay order for the tenant's chosen plan.
 * The frontend takes the returned order to Razorpay's checkout widget.
 */
async function createOrder(req, res) {
  const knex = req.app.get('db');
  const { plan } = req.body;

  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the account owner can manage billing.' } });
  }

  if (!PLAN_PRICES_INR[plan]) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `plan must be one of: ${Object.keys(PLAN_PRICES_INR).join(', ')}.` }
    });
  }

  try {
    const receiptId = `tenant_${req.user.tenant_id}_${Date.now()}`;
    const { order, amountPaise } = await createOrderForPlan(plan, receiptId);

    await knex('payment_events').insert({
      tenant_id: req.user.tenant_id,
      razorpay_order_id: order.id,
      plan,
      amount_paise: amountPaise,
      status: 'created',
    });

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        amount: amountPaise,
        currency: order.currency,
      },
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Failed to create billing order:', error.message);
    return res.status(500).json({ error: { code: 'ORDER_CREATE_FAILED', message: 'Failed to start payment. Please try again.' } });
  }
}

/**
 * POST /api/v1/dashboard/billing/verify
 * Owner-only. Frontend calls this immediately after Razorpay's checkout
 * widget reports success. The webhook (below) is the authoritative
 * fallback in case this call never completes (browser closed, network
 * drop, etc.) — both paths converge on the same idempotent update.
 */
async function verifyPayment(req, res) {
  const knex = req.app.get('db');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.' }
    });
  }

  try {
    const isValid = verifyPaymentSignature({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    if (!isValid) {
      return res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Payment could not be verified.' } });
    }

    const paymentEvent = await knex('payment_events')
      .where({ razorpay_order_id, tenant_id: req.user.tenant_id })
      .first();

    if (!paymentEvent) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No matching order found for this account.' } });
    }

    const result = await markPaymentPaid(knex, paymentEvent, razorpay_payment_id);
    return res.json({ success: true, subscription: result });
  } catch (error) {
    console.error('Failed to verify payment:', error.message);
    return res.status(500).json({ error: { code: 'VERIFY_FAILED', message: 'Failed to verify payment.' } });
  }
}

/**
 * GET /api/v1/dashboard/billing/status
 * Any authenticated dashboard user (owner or agent) can view — only owner
 * can act on it (enforced in createOrder/verifyPayment above).
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
 * POST /api/v1/webhooks/razorpay
 * Public — signature-verified via RAZORPAY_WEBHOOK_SECRET (separate from
 * the checkout signature). Authoritative source of truth for payment
 * confirmation; idempotent against the /verify call above (whichever
 * arrives first wins, the second is a no-op).
 */
async function handleRazorpayWebhook(req, res) {
  const knex = req.app.get('db');
  const signature = req.headers['x-razorpay-signature'];

  if (!verifyWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature.' } });
  }

  const event = req.body;

  try {
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        const paymentEvent = await knex('payment_events').where({ razorpay_order_id: payment.order_id }).first();
        if (paymentEvent && paymentEvent.status !== 'paid') {
          await markPaymentPaid(knex, paymentEvent, payment.id, event);
        }
      }
    }

    // Always 200 — Razorpay retries on non-2xx, and we've either handled
    // the event or intentionally ignored an event type we don't act on.
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Failed to process Razorpay webhook:', error.message);
    return res.status(200).json({ success: true, trackingError: error.message });
  }
}

/**
 * Shared by both the /verify endpoint and the webhook — marks a payment
 * event paid, extends the tenant's subscription, and sends the receipt
 * email. Idempotent: if already paid, does nothing further.
 */
async function markPaymentPaid(knex, paymentEvent, razorpayPaymentId, rawWebhookPayload = null) {
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
        razorpay_payment_id: razorpayPaymentId,
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
      // Best-effort — never let an email failure roll back a paid transaction.
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

module.exports = { getPlans, createOrder, verifyPayment, getBillingStatus, handleRazorpayWebhook };
