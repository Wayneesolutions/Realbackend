const express = require('express');
const router = express.Router();
const { handleInboundWhatsApp } = require('../controllers/webhookController');
// NEW — Phase 7 billing
const { handleRazorpayWebhook } = require('../controllers/billingController');

/**
 * @route   POST /api/v1/webhooks/whatsapp/inbound
 * @desc    Receive inbound WhatsApp messages from the BSP and queue an AI reply
 * @access  Public (HMAC signature validated internally when WHATSAPP_WEBHOOK_SECRET is set)
 */
router.post('/whatsapp/inbound', handleInboundWhatsApp);

/**
 * @route   POST /api/v1/webhooks/razorpay
 * @desc    Authoritative payment confirmation from Razorpay (payment.captured, etc.)
 * @access  Public (HMAC signature validated internally via RAZORPAY_WEBHOOK_SECRET)
 */
router.post('/razorpay', handleRazorpayWebhook);

module.exports = router;
