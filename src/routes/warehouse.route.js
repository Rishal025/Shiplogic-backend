const express = require('express');
const router = express.Router();
const controller = require('../controller/warehouse.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

router.post('/', authMiddleware, authorize(['Admin']), controller.createWarehouse);
router.get('/', authMiddleware, authorize(['Admin', 'Logistic', 'Purchase']), controller.getAllWarehouses);
router.get('/:id', authMiddleware, authorize(['Admin', 'Logistic']), controller.getWarehouseById);
router.put('/:id', authMiddleware, authorize(['Admin']), controller.updateWarehouse);
router.delete('/:id', authMiddleware, authorize(['Admin']), controller.deleteWarehouse);

module.exports = router;
