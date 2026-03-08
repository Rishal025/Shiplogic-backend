const express = require('express');
const router = express.Router();
const controller = require('../controller/shipment.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

// Only Purchase can create shipment
router.post(
  '/create',
  authMiddleware,
  authorize(['Purchase','Admin']),
  controller.createShipment
);

router.post(
  '/container/planned',
  authMiddleware,
  authorize(['Purchase','Admin']),
  controller.createPlannedContainersBulk
);

router.patch(
  '/container/actual/:id',
  authMiddleware,
  authorize(['Purchase','Admin']),
  controller.addActualContainer
);

router.patch(
  "/container/payment/:id",
  authMiddleware,
  authorize(['FAS','Admin']),
  controller.updateFASContainer
);


router.patch(
"/container/logistic/:id", 
authMiddleware,
authorize(['Logistic','Admin']),
controller.updateLogisticsDetails
);

router.patch(
  "/container/clearence-payment/:id",
  authMiddleware,
  authorize(['FAS','Admin']),
  controller.addContainerPayment
);

router.patch(
"/container/clearance/:id", 
authMiddleware,
authorize(['Logistic','Admin']),
controller.clearContainer
);

router.patch(
  '/container/grn/:id',
  authMiddleware,
  authorize(['Purchase','Admin']),
  controller.addContainerGRN
);

router.get(
  '/',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.getAllShipments
);


router.get(
  '/dashboard',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.getShipmentSummary
);

router.get(
  '/:id',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.getShipmentById
);




module.exports = router;


