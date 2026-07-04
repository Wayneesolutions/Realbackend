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

module.exports = router;
