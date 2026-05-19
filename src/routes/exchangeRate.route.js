const express = require('express');
const router = express.Router();
const controller = require('../controller/exchangeRate.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

// Read active rates — any active role (needed across all teams for shipment costing)
router.get('/active', authMiddleware, authorize({ tag: 'any-active' }), controller.getActive);

// Admin-only management
router.get('/',       authMiddleware, authorize({ tag: 'admin-only' }), controller.getAll);
router.get('/:id',    authMiddleware, authorize({ tag: 'admin-only' }), controller.getById);
router.post('/',      authMiddleware, authorize({ tag: 'admin-only' }), controller.create);
router.put('/:id',    authMiddleware, authorize({ tag: 'admin-only' }), controller.update);
router.delete('/:id', authMiddleware, authorize({ tag: 'admin-only' }), controller.remove);

module.exports = router;
