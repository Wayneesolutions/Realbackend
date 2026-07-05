const express = require('express');
const router = express.Router();
const authGuard = require('../middleware/auth');
const { login, changePassword } = require('../controllers/authController');
// NEW — Phase 7
const { loginLimiter } = require('../middleware/rateLimiter');

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate dashboard managers & agents and return scoped access tokens
 * @access  Public
 */
router.post('/login', loginLimiter, login);

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change your own password (requires current password)
 * @access  Protected
 */
router.post('/change-password', authGuard, changePassword);

module.exports = router;
