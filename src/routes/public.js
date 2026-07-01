const express = require('express');
const router = express.Router();
const { getPublicListing, logVisit, capturePublicLead } = require('../controllers/publicListingController');

router.get('/ping', (req, res) => res.json({ message: 'Public API is live' }));

/**
 * @route   GET /api/v1/public/listings/:slug
 * @desc    Expose verified public layout data frames for external map tracking
 * @access  Public
 */
router.get('/listings/:slug', getPublicListing);

/**
 * @route   POST /api/v1/public/listings/:slug/visit
 * @desc    Log a page view against a listing (Phase 3 — anonymous by default)
 * @access  Public
 */
router.post('/listings/:slug/visit', logVisit);

/**
 * @route   POST /api/v1/public/listings/:slug/lead
 * @desc    Soft phone-number capture; creates/dedupes a lead, opens a WhatsApp
 *          thread, and queues the first-touch message (Phase 3 + Phase 4)
 * @access  Public
 */
router.post('/listings/:slug/lead', capturePublicLead);

module.exports = router;
