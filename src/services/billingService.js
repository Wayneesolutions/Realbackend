const crypto = require('crypto');
const Razorpay = require('razorpay');

/**
 * Plan pricing, in whole rupees. Single source of truth — the public
 * pricing page, the dashboard billing modal, and order creation all read
 * from this object so a price change is a one-line edit.
 *
 * These are placeholder figures — confirm real pricing with Pankaj before
 * going live with paying customers.
 */
const PLAN_PRICES_INR = {
  starter: 4999,
  growth: 9999,
  unlimited: 19999,
};

const PLAN_LABELS = {
  starter: 'Starter',
  growth: 'Growth',
  unlimited: 'Unlimited',
};

const PLAN_FEATURES = {
  starter: ['Up to 15 listings', 'Shared WhatsApp number', 'Basic analytics'],
  growth: ['Up to 60 listings', 'Dedicated WhatsApp number', 'Plot boundary tracing', 'Priority support'],
  unlimited: ['Unlimited listings', 'Dedicated WhatsApp number', 'Full analytics + lead scoring', 'Priority support'],
};

function listPlans() {
  return Object.keys(PLAN_PRICES_INR).map((key) => ({
    key,
    label: PLAN_LABELS[key],
    priceINR: PLAN_PRICES_INR[key],
    features: PLAN_FEATURES[key],
  }));
}

function getRazorpayClient() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

/**
 * Creates a one-time Razorpay order for a plan renewal/upgrade.
 * Amount is in paise (Razorpay's native unit) — always an integer.
 */
async function createOrderForPlan(plan, receiptId) {
  if (!PLAN_PRICES_INR[plan]) {
    throw new Error(`Unknown plan: ${plan}`);
  }

  const razorpay = getRazorpayClient();
  const amountPaise = PLAN_PRICES_INR[plan] * 100;

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: receiptId,
    notes: { plan },
  });

  return { order, amountPaise };
}

/**
 * Verifies the signature Razorpay's checkout returns to the frontend after
 * a successful payment. This is the standard Razorpay HMAC scheme:
 * HMAC_SHA256(order_id + "|" + payment_id, key_secret) must equal the
 * signature they handed back.
 */
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay is not configured — set RAZORPAY_KEY_SECRET.');
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpaySignature));
  } catch {
    return false; // length mismatch etc. — treat as invalid, not a crash
  }
}

/**
 * Verifies a Razorpay webhook payload's signature — DIFFERENT secret from
 * the checkout signature above (RAZORPAY_WEBHOOK_SECRET, configured
 * separately in the Razorpay dashboard's webhook settings). Requires the
 * raw request body bytes, same rationale as the WhatsApp webhook's HMAC
 * check elsewhere in this codebase.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return true; // not configured yet — nothing to check against
  if (!signatureHeader || !rawBody) return false;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

module.exports = {
  PLAN_PRICES_INR,
  listPlans,
  createOrderForPlan,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
