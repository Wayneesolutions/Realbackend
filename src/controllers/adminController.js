const bcrypt = require('bcryptjs');
const crypto = require('crypto');
// NEW — Phase 7
const { sendOnboardingEmail } = require('../services/emailService');

function generateTempPassword() {
  return `Welcome${crypto.randomBytes(4).toString('hex')}!`;
}

/**
 * POST /api/v1/public/request-access
 * Public — no auth. Saves a pending onboarding request from a prospective tenant.
 */
async function submitAccessRequest(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  const { business_name, contact_name, email, phone, message } = req.body;

  if (!business_name || !contact_name || !email || !phone) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Business name, contact name, email, and phone are required.' }
    });
  }

  try {
    const existing = await knex('tenant_requests')
      .where({ email: email.trim().toLowerCase(), status: 'pending' })
      .first();

    if (existing) {
      return res.status(409).json({
        error: { code: 'DUPLICATE_REQUEST', message: 'A pending request from this email already exists.' }
      });
    }

    await knex('tenant_requests').insert({
      business_name: business_name.trim(),
      contact_name: contact_name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      message: message?.trim() || null,
    });

    return res.status(201).json({
      success: true,
      message: 'Your access request has been submitted. Our team will review and contact you shortly.'
    });
  } catch (error) {
    console.error('Failed to submit access request:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to submit request.' }
    });
  }
}

/**
 * GET /api/v1/admin/requests?status=pending
 * Lists all access requests, optionally filtered by status.
 */
async function listRequests(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  const { status } = req.query;

  try {
    let query = knex('tenant_requests').orderBy('created_at', 'desc');
    if (status) query = query.where({ status });

    const requests = await query;
    return res.json({ success: true, requests });
  } catch (error) {
    console.error('Failed to list requests:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch requests.' }
    });
  }
}

/**
 * POST /api/v1/admin/requests/:id/approve
 * Approves a pending request: creates tenant + owner user + tenant_config
 * in one transaction, then marks the request approved.
 * Returns the temporary password in the response — the same credentials
 * are also emailed to the new owner (NEW — Phase 7), so the response value
 * is now a fallback for display, not the only delivery channel.
 */
async function approveRequest(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  const { id } = req.params;
  const adminUserId = req.user.id;

  try {
    const request = await knex('tenant_requests').where({ id }).first();
    if (!request) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: `Request is already ${request.status}.` }
      });
    }

    const existingUser = await knex('users').where({ email: request.email }).first();
    if (existingUser) {
      return res.status(409).json({
        error: { code: 'DUPLICATE_EMAIL', message: 'A user with this email already exists.' }
      });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    let newTenant, newUser;

    await knex.transaction(async (trx) => {
      [newTenant] = await trx('tenants').insert({
        business_name: request.business_name,
        plan: 'starter',
        whatsapp_mode: 'shared',
        status: 'active',
      }).returning(['id', 'business_name', 'plan', 'status']);

      [newUser] = await trx('users').insert({
        tenant_id: newTenant.id,
        name: request.contact_name,
        email: request.email,
        password_hash: hashedPassword,
        role: 'owner',
      }).returning(['id', 'email', 'role']);

      await trx('tenant_configs').insert({
        tenant_id: newTenant.id,
        bsp_provider_type: 'shared_gateway',
        bsp_auth_token: null,
      });

      await trx('tenant_requests').where({ id }).update({
        status: 'approved',
        reviewed_by: adminUserId,
        reviewed_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    });

    // NEW — Phase 7: email the credentials. Best-effort; never blocks the
    // response, and the temp password is still returned below regardless.
    sendOnboardingEmail({
      to: newUser.email,
      businessName: newTenant.business_name,
      contactName: request.contact_name,
      email: newUser.email,
      tempPassword,
    }).catch((err) => console.error('Onboarding email failed (non-fatal):', err.message));

    return res.status(201).json({
      success: true,
      message: 'Request approved. Tenant account created.',
      tenant: newTenant,
      user: newUser,
      temporaryPassword: tempPassword,
    });
  } catch (error) {
    console.error('Failed to approve request:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to approve request.' }
    });
  }
}

/**
 * POST /api/v1/admin/requests/:id/reject
 */
async function rejectRequest(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  const { id } = req.params;
  const adminUserId = req.user.id;

  try {
    const request = await knex('tenant_requests').where({ id }).first();
    if (!request) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: `Request is already ${request.status}.` }
      });
    }

    await knex('tenant_requests').where({ id }).update({
      status: 'rejected',
      reviewed_by: adminUserId,
      reviewed_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

    return res.json({ success: true, message: 'Request rejected.' });
  } catch (error) {
    console.error('Failed to reject request:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to reject request.' }
    });
  }
}

/**
 * POST /api/v1/admin/tenants
 * Directly creates a new tenant without going through the request flow.
 * Also emails the credentials (NEW — Phase 7), same as approveRequest.
 */
async function createTenant(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  const { business_name, contact_name, email, phone } = req.body;

  if (!business_name || !contact_name || !email || !phone) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Business name, contact name, email, and phone are required.' }
    });
  }

  try {
    const existingUser = await knex('users').where({ email: email.trim().toLowerCase() }).first();
    if (existingUser) {
      return res.status(409).json({
        error: { code: 'DUPLICATE_EMAIL', message: 'A user with this email already exists.' }
      });
    }

    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    let newTenant, newUser;

    await knex.transaction(async (trx) => {
      [newTenant] = await trx('tenants').insert({
        business_name: business_name.trim(),
        plan: 'starter',
        whatsapp_mode: 'shared',
        status: 'active',
      }).returning(['id', 'business_name', 'plan', 'status']);

      [newUser] = await trx('users').insert({
        tenant_id: newTenant.id,
        name: contact_name.trim(),
        email: email.trim().toLowerCase(),
        password_hash: hashedPassword,
        role: 'owner',
      }).returning(['id', 'email', 'role']);

      await trx('tenant_configs').insert({
        tenant_id: newTenant.id,
        bsp_provider_type: 'shared_gateway',
        bsp_auth_token: null,
      });
    });

    // NEW — Phase 7: email the credentials, best-effort.
    sendOnboardingEmail({
      to: newUser.email,
      businessName: newTenant.business_name,
      contactName: contact_name.trim(),
      email: newUser.email,
      tempPassword,
    }).catch((err) => console.error('Onboarding email failed (non-fatal):', err.message));

    return res.status(201).json({
      success: true,
      message: 'Tenant account created.',
      tenant: newTenant,
      user: newUser,
      temporaryPassword: tempPassword,
    });
  } catch (error) {
    console.error('Failed to create tenant:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create tenant.' }
    });
  }
}

/**
 * GET /api/v1/admin/tenants
 * Lists all tenants with their user counts.
 */
async function listTenants(req, res) {
  const knex = req.dbTrx || req.app.get('db');
  try {
    const tenants = await knex('tenants')
      .select(
        'tenants.id',
        'tenants.business_name',
        'tenants.plan',
        'tenants.status',
        'tenants.subscription_status',
        'tenants.current_period_end',
        'tenants.created_at',
        knex.raw('count(users.id)::int as user_count')
      )
      .leftJoin('users', function () {
        // exclude the super_admin user from the count — they float above tenants
        this.on('tenants.id', '=', 'users.tenant_id')
            .andOnVal('users.role', '!=', 'super_admin');
      })
      .groupBy('tenants.id')
      .orderBy('tenants.created_at', 'desc');

    return res.json({ success: true, tenants });
  } catch (error) {
    console.error('Failed to list tenants:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tenants.' }
    });
  }
}

module.exports = {
  submitAccessRequest,
  listRequests,
  approveRequest,
  rejectRequest,
  createTenant,
  listTenants,
};
