const express = require('express');
const router = express.Router();
const controller = require('../controller/transportationCompany.controller');
const authMiddleware = require('../core/utils/authMiddleware');
const authorize = require('../core/utils/authorize');

// All roles that interact with logistics can read; only Admin manages
router.get('/',    authMiddleware, authorize(['Admin', 'Logistic', 'Purchase', 'FAS']), controller.getAll);
router.get('/:id', authMiddleware, authorize(['Admin', 'Logistic']), controller.getById);
router.post('/',   authMiddleware, authorize(['Admin']), controller.create);
router.put('/:id', authMiddleware, authorize(['Admin']), controller.update);
router.delete('/:id', authMiddleware, authorize(['Admin']), controller.remove);

module.exports = router;
