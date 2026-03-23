const express = require('express');
const router = express.Router();
const itemController = require('../controller/item.controller');
const authMiddleware = require('../core/utils/authMiddleware'); // JWT verification
const authorize = require('../core/utils/authorize'); // role-based access

// CREATE ITEM - Purchase or FAS only
router.post(
  '/create',
  authMiddleware,
  authorize(['Purchase','FAS','Admin']),
  itemController.createItem
);

// GET ITEMS - any role can see, with pagination
router.get(
  '/all',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  itemController.getItems
);

router.get(
  '/by-code/:itemCode',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  itemController.getItemListByCode
);

// GET ITEM BY ID - must be after /all
router.get(
  '/:id',
  authMiddleware,
  authorize(['Purchase','FAS','Logistics','Manager','Admin']),
  itemController.getItemById
);

module.exports = router;
