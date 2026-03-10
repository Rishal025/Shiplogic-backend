const express = require('express');
const router = express.Router();
const multer = require('multer');
const controller = require('../controller/shipment.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

// Multer: memory storage for document uploads (for Python service later)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|jpg|jpeg|png|gif|webp)$/i.test(file.originalname);
    if (allowed) cb(null, true);
    else cb(new Error('Only PDF and image files are allowed'));
  }
});

// Only Purchase can create shipment
router.post(
  '/create',
  authMiddleware,
  authorize(['Purchase','Admin']),
  controller.createShipment
);

// Extract data from PI/PO documents — calls Python service, returns mapped response only
router.post(
  '/extract-documents',
  authMiddleware,
  authorize(['Purchase','Admin']),
  (req, res, next) => {
    upload.fields([{ name: 'document1', maxCount: 1 }, { name: 'document2', maxCount: 1 }])(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Invalid file upload' });
      }
      next();
    });
  },
  controller.extractFromDocuments
);

// Extract bill number from a single document (PDF or image) — calls Python purchase-tracker/bill-no
router.post(
  '/extract-bill-no',
  authMiddleware,
  authorize(['Purchase','Admin']),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Invalid file upload' });
      }
      next();
    });
  },
  controller.extractBillNo
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


