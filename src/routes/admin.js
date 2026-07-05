const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const adminGuard = require('../middleware/adminGuard');
const {
  listRequests,
  approveRequest,
  rejectRequest,
  createTenant,
  listTenants,
} = require('../controllers/adminController');
// NEW — Phase 6 monetization (super-admin ad management)
const {
  listAdPlacements,
  createAdPlacement,
  updateAdPlacement,
} = require('../controllers/adminAdsController');

// Every admin route requires a valid JWT (authGuard) AND super_admin role (adminGuard)
router.use(authGuard, adminGuard);

/**
 * @route   GET /api/v1/admin/requests
 * @desc    List all access requests; filter by ?status=pending|approved|rejected
 */
router.get('/requests', listRequests);

/**
 * @route   POST /api/v1/admin/requests/:id/approve
 * @desc    Approve a pending request — creates tenant + owner user + tenant_config
 */
router.post('/requests/:id/approve', approveRequest);

/**
 * @route   POST /api/v1/admin/requests/:id/reject
 * @desc    Reject a pending request
 */
router.post('/requests/:id/reject', rejectRequest);

/**
 * @route   GET /api/v1/admin/tenants
 * @desc    List all tenants with user counts
 */
router.get('/tenants', listTenants);

/**
 * @route   POST /api/v1/admin/tenants
 * @desc    Directly create a new tenant without a request
 */
router.post('/tenants', createTenant);

/**
 * @route   GET /api/v1/admin/ads
 * @desc    List all ad placements with lifetime impression/click counts
 */
router.get('/ads', listAdPlacements);

/**
 * @route   POST /api/v1/admin/ads
 * @desc    Create a new ad placement
 */
router.post('/ads', createAdPlacement);

/**
 * @route   PATCH /api/v1/admin/ads/:id
 * @desc    Update an ad placement (toggle is_active, fix a URL, extend dates, etc.)
 */
router.patch('/ads/:id', updateAdPlacement);

module.exports = router;
