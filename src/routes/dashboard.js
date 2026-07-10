const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const tenantTransaction = require('../middleware/tenantTransaction');
const { createListing, getListings } = require('../controllers/listingController');
const { getDashboardAnalytics } = require('../controllers/analyticsController');
const { updateListingBoundary } = require('../controllers/listingBoundaryController');
const { inviteTenantUser } = require('../controllers/userInviteController');
const { createCheckoutSessionHandler, cancelSubscriptionHandler, getBillingStatus } = require('../controllers/billingController');
const { uploadMiddleware, getListingMedia, uploadListingPhoto, deleteListingPhoto } = require('../controllers/mediaController');

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

/**
 * @route   GET  /api/v1/dashboard/listings/:id/media
 * @desc    Get photo_urls for a listing
 * @route   POST /api/v1/dashboard/listings/:id/media
 * @desc    Upload a photo to S3 and append the URL to the listing's photo_urls
 * @route   DELETE /api/v1/dashboard/listings/:id/media
 * @desc    Remove a photo from S3 and from the listing's photo_urls
 */
router.get('/listings/:id/media', authGuard, tenantTransaction, getListingMedia);
router.post('/listings/:id/media', authGuard, uploadMiddleware, tenantTransaction, uploadListingPhoto);
router.delete('/listings/:id/media', authGuard, tenantTransaction, deleteListingPhoto);

/**
 * BUG FIX: these two billing routes previously had authGuard but NOT
 * tenantTransaction — they queried via the raw connection pool with no
 * tenant context set at all. Under the old permissive RLS (allow
 * everything when no context is set) this happened to still be safe only
 * because of the app-layer .where({tenant_id}) clauses already in the
 * controller. Under the new default-deny RLS, missing tenantTransaction
 * here would make these routes return zero rows instead of the tenant's
 * actual billing data. Added for correctness and consistency with every
 * other tenant-scoped route.
 */
router.post('/billing/create-checkout-session', authGuard, tenantTransaction, createCheckoutSessionHandler);
router.post('/billing/cancel-subscription', authGuard, tenantTransaction, cancelSubscriptionHandler);
router.get('/billing/status', authGuard, tenantTransaction, getBillingStatus);

module.exports = router;
