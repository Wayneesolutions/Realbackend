const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_production';
const JWT_EXPIRES_IN = '12h'; // Optimal window for backoffice operational shift length

/**
 * Handles agent/owner login and issues tenant-scoped authorization claims.
 */
async function login(req, res) {
  const knex = req.app.get('db'); // Reference to our migrated Knex client
  const { email, password } = req.body;

  // 1. Core input verification
  if (!email || !password) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Email and password are required fields.' }
    });
  }

  try {
    // 2. Locate user and eagerly join active tenant status profile
    const user = await knex('users')
      .join('tenants', 'users.tenant_id', 'tenants.id')
      .select(
        'users.id',
        'users.tenant_id',
        'users.name',
        'users.email',
        'users.password_hash',
        'users.role',
        'tenants.status as tenant_status',
        'tenants.business_name'
      )
      .where('users.email', email.trim().toLowerCase())
      .first();

    // 3. Fail gracefully if user doesn't exist (using vague errors to protect footprint discovery)
    if (!user) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid authentication credentials.' }
      });
    }

    // 4. Validate system and tenant isolation health
    if (user.tenant_status !== 'active') {
      return res.status(403).json({
        error: { code: 'TENANT_LOCKED', message: 'Account context suspended or inactive. Please contact billing support.' }
      });
    }

    // 5. Verify cryptographically hashed password structure match
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid authentication credentials.' }
      });
    }

    // 6. Generate signed token container asserting immutable multi-tenant identity scope
    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // 7. Dispatch success envelope containing application-ready details
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessName: user.business_name
      }
    });

  } catch (error) {
    console.error('Login routing runtime failure:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authentication handshake engine experienced a system crash.' }
    });
  }
}

/**
 * Lets an authenticated user change their own password. Verifies the
 * current password before applying the new one.
 */
async function changePassword(req, res) {
  const knex = req.app.get('db');
  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Current password and new password are both required.' }
    });
  }

  try {
    const user = await knex('users').where({ id: userId }).first();
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(400).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' }
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await knex('users')
      .where({ id: userId })
      .update({ password_hash: newHash, updated_at: knex.fn.now() });

    return res.status(200).json({ success: true, message: 'Password updated.' });

  } catch (error) {
    console.error('Failed to change password:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update password.' }
    });
  }
}

module.exports = { login, changePassword };