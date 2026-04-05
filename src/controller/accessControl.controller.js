const logAudit = require('../core/utils/auditLogger');
const Role = require('../models/role.model');
const Permission = require('../models/permission.model');
const RolePermission = require('../models/rolePermission.model');
const User = require('../models/auth.model');
const { normalizeRole } = require('../core/utils/roleHelpers');
const { sendInternalUserInviteEmail } = require('../services/mail.service');
const {
  DEFAULT_ROLES,
  ensureRolesSeeded,
} = require('../config/seedAccessControl');

function roleResponse(role) {
  return {
    _id: role._id,
    key: role.key,
    name: role.name,
    description: role.description || '',
    isActive: role.isActive,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function permissionResponse(permission) {
  return {
    _id: permission._id,
    key: permission.key,
    resource: permission.resource,
    screen: permission.screen || '',
    tab: permission.tab || '',
    field: permission.field || '',
    action: permission.action || '',
    type: permission.type,
    label: permission.label,
    description: permission.description || '',
    isActive: permission.isActive,
    sortOrder: permission.sortOrder || 0,
  };
}

function buildPermissionGroups(permissions, assignedKeys = new Set()) {
  const groups = new Map();

  permissions.forEach((permission) => {
    const groupKey = permission.tab || permission.screen || permission.resource;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        label: permission.tab
          ? permission.tab.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
          : permission.screen
            ? permission.screen.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
            : permission.resource,
        permissions: [],
      });
    }

    groups.get(groupKey).permissions.push({
      ...permissionResponse(permission),
      assigned: assignedKeys.has(permission.key),
    });
  });

  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function userResponse(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function generateTemporaryPassword(length = Number(process.env.INVITE_PASSWORD_LENGTH || 10)) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function getAssignedPermissionKeys(roleKey) {
  const normalizedRoleKey = normalizeRole(roleKey);
  if (normalizedRoleKey === 'Manager') {
    const allPermissions = await Permission.find({ isActive: true }).select('key').lean();
    return allPermissions.map((permission) => permission.key);
  }

  const assignments = await RolePermission.find({ roleKey: normalizedRoleKey, allowed: true }).lean();
  return assignments.map((assignment) => assignment.permissionKey);
}

exports.listRoles = async (req, res) => {
  try {
    await ensureRolesSeeded();
    const roles = await Role.find().sort({ isSystem: -1, name: 1 });
    res.json({ roles: roles.map(roleResponse) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load roles', error: error.message });
  }
};

exports.createRole = async (req, res) => {
  try {
    const key = String(req.body.key || '').trim();
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();

    if (!key || !name) {
      return res.status(400).json({ message: 'Role key and name are required' });
    }

    const existing = await Role.findOne({ key });
    if (existing) {
      return res.status(400).json({ message: 'Role key already exists' });
    }

    const role = await Role.create({
      key,
      name,
      description,
      isActive: req.body.isActive !== false,
      isSystem: false,
    });

    await logAudit({
      userId: req.user._id,
      module: 'Access Control',
      entity: 'Role',
      entityId: role._id,
      action: 'Created',
      before: {},
      after: roleResponse(role),
      remarks: `Created RBAC role ${role.key}`,
    });

    res.status(201).json({ message: 'Role created', role: roleResponse(role) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to create role', error: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    const before = roleResponse(role);

    role.name = String(req.body.name || role.name).trim();
    role.description = String(req.body.description ?? role.description ?? '').trim();
    if (typeof req.body.isActive === 'boolean') {
      role.isActive = req.body.isActive;
    }

    await role.save();

    await logAudit({
      userId: req.user._id,
      module: 'Access Control',
      entity: 'Role',
      entityId: role._id,
      action: 'Updated',
      before,
      after: roleResponse(role),
      remarks: `Updated RBAC role ${role.key}`,
    });

    res.json({ message: 'Role updated', role: roleResponse(role) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to update role', error: error.message });
  }
};

exports.listPermissions = async (req, res) => {
  try {
    const resource = String(req.query.resource || '').trim();
    const query = resource ? { resource } : {};
    const permissions = await Permission.find(query).sort({ sortOrder: 1, label: 1 });
    res.json({ permissions: permissions.map(permissionResponse) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load permissions', error: error.message });
  }
};

exports.getEffectivePermissions = async (req, res) => {
  try {
    const permissionKeys = await getAssignedPermissionKeys(req.user.role);
    const permissions = await Permission.find({ key: { $in: permissionKeys }, isActive: true }).sort({ sortOrder: 1, label: 1 });

    res.json({
      role: normalizeRole(req.user.role),
      permissionKeys,
      permissionGroups: buildPermissionGroups(permissions, new Set(permissionKeys)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load effective permissions', error: error.message });
  }
};

exports.getRolePermissions = async (req, res) => {
  try {
    await ensureRolesSeeded();

    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    const permissions = await Permission.find().sort({ resource: 1, sortOrder: 1, label: 1 });
    const assignments = await RolePermission.find({ roleKey: role.key, allowed: true });
    const assignedKeys = new Set(assignments.map((assignment) => assignment.permissionKey));

    res.json({
      role: roleResponse(role),
      permissionGroups: buildPermissionGroups(permissions, assignedKeys),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load role permissions', error: error.message });
  }
};

exports.updateRolePermissions = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ message: 'Role not found' });
    }

    const permissionKeys = Array.isArray(req.body.permissionKeys)
      ? req.body.permissionKeys.map((key) => String(key || '').trim()).filter(Boolean)
      : [];

    const validPermissions = await Permission.find({ key: { $in: permissionKeys } });
    const validKeys = new Set(validPermissions.map((permission) => permission.key));

    await RolePermission.deleteMany({ roleKey: role.key });

    if (validKeys.size > 0) {
      await RolePermission.insertMany(
        Array.from(validKeys).map((permissionKey) => ({
          roleKey: role.key,
          permissionKey,
          allowed: true,
        }))
      );
    }

    await logAudit({
      userId: req.user._id,
      module: 'Access Control',
      entity: 'RolePermission',
      entityId: role._id,
      action: 'Updated',
      before: {},
      after: { roleKey: role.key, permissionKeys: Array.from(validKeys) },
      remarks: `Updated permissions for role ${role.key}`,
    });

    const permissions = await Permission.find().sort({ resource: 1, sortOrder: 1, label: 1 });
    res.json({
      message: 'Role permissions updated',
      role: roleResponse(role),
      permissionGroups: buildPermissionGroups(permissions, validKeys),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to update role permissions', error: error.message });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    const roles = await Role.find({ isActive: true }).sort({ isSystem: -1, name: 1 });

    res.json({
      users: users.map(userResponse),
      roles: roles.map(roleResponse),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to load users', error: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const before = userResponse(user);
    const nextRole = String(req.body.role || user.role).trim();

    if (nextRole) {
      const roleExists = await Role.findOne({ key: nextRole, isActive: true });
      if (!roleExists) {
        return res.status(400).json({ message: 'Selected role is not available' });
      }
      user.role = nextRole;
    }

    if (typeof req.body.isActive === 'boolean') {
      user.isActive = req.body.isActive;
    }

    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      user.name = req.body.name.trim();
    }

    await user.save();

    await logAudit({
      userId: req.user._id,
      module: 'Access Control',
      entity: 'User',
      entityId: user._id,
      action: 'Updated',
      before,
      after: userResponse(user),
      remarks: `Updated user access for ${user.email}`,
    });

    res.json({ message: 'User updated', user: userResponse(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to update user', error: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || '').trim();

    if (!name || !email || !role) {
      return res.status(400).json({ message: 'Name, email, and role are required' });
    }

    const roleExists = await Role.findOne({ key: role, isActive: true });
    if (!roleExists) {
      return res.status(400).json({ message: 'Selected role is not available' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const temporaryPassword = generateTemporaryPassword();
    const user = await User.create({
      name,
      email,
      password: temporaryPassword,
      role,
      isActive: req.body.isActive !== false,
      mustChangePassword: true,
    });

    await sendInternalUserInviteEmail({
      to: email,
      userName: name,
      role,
      temporaryPassword,
    });

    await logAudit({
      userId: req.user._id,
      module: 'Access Control',
      entity: 'User',
      entityId: user._id,
      action: 'Created',
      before: {},
      after: userResponse(user),
      remarks: `Created internal user ${user.email} and sent invite email`,
    });

    res.status(201).json({
      message: 'User created and invite email sent',
      user: userResponse(user),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Unable to create user', error: error.message });
  }
};
