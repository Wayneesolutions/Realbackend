const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Invites a second user under the same tenant. Owner-only. Returns the
 * temp password in the response for now — no email service wired up yet,
 * so you'll copy-paste it to them over WhatsApp for the first few users.
 */
async function inviteTenantUser(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  const { tenant_id, role } = req.user;
  const { email, name } = req.body;

  if (role !== 'owner') {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only tenant owners can invite team members.' }
    });
  }

  if (!email || !name) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Email and name are required.' }
    });
  }

  try {
    const existingUser = await knex('users').where({ email: email.trim().toLowerCase() }).first();
    if (existingUser) {
      return res.status(409).json({
        error: { code: 'DUPLICATE_ENTRY', message: 'A user with this email already exists.' }
      });
    }

    const tempPassword = `Welcome${crypto.randomBytes(4).toString('hex')}!`;
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const [newUser] = await knex('users').insert({
      tenant_id,
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: 'agent',
      password_hash: hashedPassword
    }).returning(['id', 'email', 'role']);

    return res.status(201).json({
      success: true,
      message: 'User created. Share the temporary password with them directly — it will not be shown again.',
      user: newUser,
      temporaryPassword: tempPassword
    });

  } catch (error) {
    console.error('Failed to invite tenant user:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create the user.' }
    });
  }
}

module.exports = { inviteTenantUser };
