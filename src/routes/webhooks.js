const express = require('express');
const router = express.Router();
const { handleInboundWhatsApp } = require('../controllers/webhookController');

/**
 * @route   POST /api/v1/webhooks/whatsapp/inbound
 * @desc    Receive inbound WhatsApp messages from the BSP and queue an AI reply
 * @access  Public (HMAC signature validated internally when WHATSAPP_WEBHOOK_SECRET is set)
 */
router.post('/whatsapp/inbound', handleInboundWhatsApp);

module.exports = router;
