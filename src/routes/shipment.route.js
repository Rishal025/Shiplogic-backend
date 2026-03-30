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
  (req, res, next) => {
    upload.fields([
      { name: 'lpoDocument', maxCount: 1 },
      { name: 'proformaDocument', maxCount: 1 },
      { name: 's1QualityReport', maxCount: 1 }
    ])(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Invalid file upload' });
      }
      next();
    });
  },
  controller.createShipment
);

// Extract data from PI/PO documents — calls Python service, returns mapped response only
router.post(
  '/extract-documents',
  authMiddleware,
  authorize(['Purchase','Admin']),
  (req, res, next) => {
    upload.fields([
      { name: 'document1', maxCount: 1 },
      { name: 's1QualityReport', maxCount: 1 }
    ])(req, res, (err) => {
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
  '/extract-arrival-notice',
  authMiddleware,
  authorize(['Logistic','Admin']),
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Invalid file upload' });
      }
      next();
    });
  },
  controller.extractArrivalNotice
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
  (req, res, next) => {
    upload.fields([{ name: 'blDocument', maxCount: 1 }])(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.addActualContainer
);

router.patch(
  '/container/bl-details/:id',
  authMiddleware,
  authorize(['Purchase','Admin']),
  (req, res, next) => {
    upload.fields([{ name: 'costSheetBookingDocument', maxCount: 1 }])(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.updateBLDetails
);

router.patch(
  "/container/payment/:id",
  authMiddleware,
  authorize(['FAS','Admin']),
  (req, res, next) => {
    upload.fields([
      { name: 'inwardCollectionAdviceDocument', maxCount: 1 },
      { name: 'murabahaContractSubmittedDocument', maxCount: 1 },
      { name: 'documentsReleasedDocument', maxCount: 1 }
    ])(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.updateFASContainer
);


router.patch(
"/container/logistic/:id", 
authMiddleware,
authorize(['Logistic','Admin']),
(req, res, next) => {
  upload.fields([
    { name: 'arrivalNoticeDocument', maxCount: 1 },
    { name: 'advanceRequestDocument', maxCount: 1 },
    { name: 'doReleasedDocument', maxCount: 1 },
    { name: 'dpApprovalDocument', maxCount: 1 },
    { name: 'customsClearanceDocument', maxCount: 1 },
    { name: 'municipalityDocument', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
    next();
  });
},
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
  '/container/storage/:id',
  authMiddleware,
  authorize(['Logistic','Admin']),
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.updateStorageDetails
);

router.patch(
  '/container/storage-row/:id/:rowIndex',
  authMiddleware,
  authorize(['Logistic','Admin']),
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.updateStorageArrivalRow
);

router.patch(
  '/container/quality/:id',
  authMiddleware,
  authorize(['Purchase','Admin']),
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.updateQualityDetails
);

router.patch(
  '/container/payment-costing/:id',
  authMiddleware,
  authorize(['FAS','Admin']),
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Invalid file upload' });
      next();
    });
  },
  controller.updatePaymentCostingDetails
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
  '/reports/export-data',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.getShipmentReportExportData
);

router.get(
  '/reports/export/excel',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.downloadShipmentReportExcel
);

router.get(
  '/reports/export/pdf',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.downloadShipmentReportPdf
);

router.get(
  '/:id',
  authMiddleware,
  authorize(['Purchase','FAS','Logistic','Admin']),
  controller.getShipmentById
);




module.exports = router;
