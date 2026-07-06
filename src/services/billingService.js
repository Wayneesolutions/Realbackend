const Stripe = require('stripe');

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

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured — set STRIPE_SECRET_KEY.');
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Creates a Stripe Checkout Session for a plan payment.
 * Returns the hosted checkout URL — frontend redirects the user there.
 * Amount is in paise (Stripe's unit for INR), always an integer.
 */
async function createCheckoutSession({ plan, paymentEventId, userEmail, successUrl, cancelUrl }) {
  if (!PLAN_PRICES_INR[plan]) throw new Error(`Unknown plan: ${plan}`);

  const stripe = getStripeClient();
  const amountPaise = PLAN_PRICES_INR[plan] * 100;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: userEmail,
    line_items: [{
      price_data: {
        currency: 'inr',
        product_data: {
          name: `PropertyPro ${PLAN_LABELS[plan]} Plan`,
          description: '30-day access',
        },
        unit_amount: amountPaise,
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { plan, payment_event_id: paymentEventId },
  });

  return { sessionId: session.id, url: session.url, amountPaise };
}

/**
 * Verifies a Stripe webhook signature using the raw request body.
 * Throws if invalid — caller should return 400.
 * If STRIPE_WEBHOOK_SECRET is not set, skips verification (dev mode).
 */
function constructStripeEvent(rawBody, signatureHeader) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return null;
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = {
  PLAN_PRICES_INR,
  listPlans,
  createCheckoutSession,
  constructStripeEvent,
};
