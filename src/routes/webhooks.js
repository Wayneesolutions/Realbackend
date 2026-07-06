const express = require('express');
const router = express.Router();
const { handleInboundWhatsApp } = require('../controllers/webhookController');
const { handleStripeWebhook } = require('../controllers/billingController');

router.post('/whatsapp/inbound', handleInboundWhatsApp);
router.post('/stripe', handleStripeWebhook);

module.exports = router;
