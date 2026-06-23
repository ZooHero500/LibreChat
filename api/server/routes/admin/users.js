const express = require('express');
const { createAdminUsersHandlers } = require('@librechat/api');
const { SystemCapabilities, logger, isValidObjectIdString } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { registerUser } = require('~/server/services/AuthService');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
});

const VALID_ROLES = new Set([SystemRoles.USER, SystemRoles.ADMIN]);

async function createUserHandler(req, res) {
  const { email, name, username, password, role } = req.body ?? {};
  if (!email || !name || !username || !password) {
    return res.status(400).json({ error: 'email, name, username and password are required' });
  }
  const userRole = VALID_ROLES.has(role) ? role : SystemRoles.USER;
  try {
    const existing = await db.findUser({ email }, 'email');
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const result = await registerUser(
      { email, name, username, password, confirm_password: password },
      { role: userRole, emailVerified: true },
    );
    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.message });
    }
    return res.status(201).json({ message: 'User created' });
  } catch (error) {
    logger.error('[adminUsers] createUser error:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
}

async function setUserDisabledHandler(req, res) {
  const { id } = req.params;
  const { disabled } = req.body ?? {};
  if (!isValidObjectIdString(id)) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }
  if (typeof disabled !== 'boolean') {
    return res.status(400).json({ error: '`disabled` must be a boolean' });
  }
  const callerId = req.user?._id?.toString() ?? req.user?.id;
  if (callerId === id) {
    return res.status(403).json({ error: 'Cannot disable your own account' });
  }
  try {
    const updated = await db.updateUser(id, { disabled });
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({ message: disabled ? 'User disabled' : 'User enabled', disabled });
  } catch (error) {
    logger.error('[adminUsers] setUserDisabled error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
}

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.post('/', requireManageUsers, createUserHandler);
router.patch('/:id/disabled', requireManageUsers, setUserDisabledHandler);
router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
