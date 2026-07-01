const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const dashboardRouter = require('./routes/dashboard');
const publicRouter = require('./routes/public');
const webhooksRouter = require('./routes/webhooks');

const app = express();

// CORS_ORIGIN: comma-separated list of allowed frontend origins in production
// (e.g. "https://app.yourdomain.com"). Left unset in local dev, this allows
// any origin — fine for a laptop, not for production once the frontend is
// deployed at a real address (this matters even more once frontend/backend
// live in separate deployments, e.g. S3+CloudFront vs. EC2 on AWS).
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : true; // true = allow any origin (dev default)

app.use(cors({ origin: allowedOrigins, credentials: true }));

// Capture the raw request body alongside the parsed one — webhookController's
// HMAC signature check needs the exact bytes the BSP signed, which
// JSON.stringify(req.body) cannot reliably reproduce (key order/whitespace
// can differ from what was sent).
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Auth routes (login)
app.use('/api/v1/auth', authRouter);

// Public buyer-facing routes (no auth required)
app.use('/api/v1/public', publicRouter);

// Public webhook ingest (BSP can't send a Bearer token — verified via HMAC instead)
app.use('/api/v1/webhooks', webhooksRouter);

// Protected dealer dashboard routes
app.use('/api/v1/dashboard', dashboardRouter);

module.exports = app;
