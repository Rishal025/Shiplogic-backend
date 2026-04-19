const express = require('express');
const router = express.Router();
const controller = require('../controller/exchangeRate.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

// All authenticated users can read active rates (needed for shipment creation)
router.get('/active', authMiddleware, authorize(['Admin', 'Purchase', 'FAS', 'Logistic']), controller.getActive);
router.get('/',       authMiddleware, authorize(['Admin']), controller.getAll);
router.get('/:id',    authMiddleware, authorize(['Admin']), controller.getById);
router.post('/',      authMiddleware, authorize(['Admin']), controller.create);
router.put('/:id',    authMiddleware, authorize(['Admin']), controller.update);
router.delete('/:id', authMiddleware, authorize(['Admin']), controller.remove);

module.exports = router;
