const express = require('express');
const router = express.Router();
const Supplier = require('../models/supplier.model')
const supplierController = require('../controller/supplier.controller');
const authMiddleware = require('../core/utils/authMiddleware'); // JWT verification
const authorize = require('../core/utils/authorize'); // role-based access

// Only Purchase, FAS, and Manager can create suppliers
router.post(
  '/create',
  authMiddleware,
  authorize(['Purchase','FAS','Admin']), // Manager bypass handled automatically in middleware
  supplierController.createSupplier
);

// Get all suppliers - any role can see
router.get(
  '/all',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  async (req, res) => {
    try {
      let { page = 1, limit = 20, search = '' } = req.query;
      page = parseInt(page);
      limit = parseInt(limit);

      const query = {};

      if (search) {
        // Search by supplierCode or name (case-insensitive)
        query.$or = [
          { supplierCode: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } }
        ];
      }

      const total = await Supplier.countDocuments(query);
      const suppliers = await Supplier.find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });

      res.json({
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        suppliers
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get supplier by ID - must be after /all
router.get(
  '/:id',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  supplierController.getSupplierById
);

module.exports = router;

