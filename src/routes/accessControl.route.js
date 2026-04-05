const express = require('express');
const router = express.Router();
const accessControlController = require('../controller/accessControl.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

router.use(authMiddleware);
router.get('/effective-permissions', accessControlController.getEffectivePermissions);
router.use(authorize(['Admin', 'Manager']));

router.get('/roles', accessControlController.listRoles);
router.post('/roles', accessControlController.createRole);
router.patch('/roles/:id', accessControlController.updateRole);
router.get('/permissions', accessControlController.listPermissions);
router.get('/roles/:id/permissions', accessControlController.getRolePermissions);
router.put('/roles/:id/permissions', accessControlController.updateRolePermissions);
router.get('/users', accessControlController.listUsers);
router.post('/users', accessControlController.createUser);
router.patch('/users/:id', accessControlController.updateUser);

module.exports = router;
