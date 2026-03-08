const express = require('express');
const router = express.Router();
const controller = require('../controller/purchase.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

// CREATE PO (Purchase only)
router.post(
  '/create',
  authMiddleware,
  authorize(['Purchase']),
  controller.createPurchaseOrder
);

// GET ALL POs (All roles can view)
router.get(
  '/',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  controller.getPurchaseOrders
);

// GET SINGLE PO
router.get(
  '/:id',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  controller.getPurchaseOrderById
);

// UPDATE PO (Purchase only)
router.patch(
  '/:id',
  authMiddleware,
  authorize(['Purchase','Admin']),
  controller.updatePurchaseOrder
);

module.exports = router;
