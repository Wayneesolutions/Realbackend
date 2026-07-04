const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const tenantTransaction = require('../middleware/tenantTransaction');
const { createListing, getListings } = require('../controllers/listingController');
const { getDashboardAnalytics } = require('../controllers/analyticsController');
const { updateListingBoundary } = require('../controllers/listingBoundaryController');
const { inviteTenantUser } = require('../controllers/userInviteController');

// tenantTransaction must come after authGuard (needs req.user.tenant_id) and
// wraps the controller in a single DB transaction with SET LOCAL tenant context
// for RLS enforcement.

/**
 * @route   POST /api/v1/dashboard/listings
 * @desc    Create a new real estate property asset and dispatch maps caching jobs
 * @access  Protected (Requires active Dealer/Agent Auth Bearer token)
 */
router.post('/listings', authGuard, tenantTransaction, createListing);

/**
 * @route   GET /api/v1/dashboard/listings
 * @desc    List all listings for the current tenant, with a visit_count per listing
 * @access  Protected (Requires active Dealer/Agent Auth Bearer token)
 */
router.get('/listings', authGuard, tenantTransaction, getListings);

/**
 * @route   PATCH /api/v1/dashboard/listings/:id/boundary
 * @desc    Save a traced plot boundary (GeoJSON) for a listing
 * @access  Protected
 */
router.patch('/listings/:id/boundary', authGuard, tenantTransaction, updateListingBoundary);

/**
 * @route   GET /api/v1/dashboard/analytics
 * @desc    Fetch aggregated real estate traffic metrics, lead capture metrics, and recent activity
 * @access  Protected (Requires Active Agent/Owner Bearer Token)
 */
router.get('/analytics', authGuard, tenantTransaction, getDashboardAnalytics);

/**
 * @route   POST /api/v1/dashboard/users/invite
 * @desc    Invite a second user (agent) under the same tenant — owner only
 * @access  Protected (owner role)
 */
router.post('/users/invite', authGuard, tenantTransaction, inviteTenantUser);

module.exports = router;
