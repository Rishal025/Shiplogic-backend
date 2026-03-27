const express = require('express');
const router = express.Router();
const notificationController = require('../controller/notification.controller');
const authMiddleware = require('../core/utils/authMiddleware');

router.get('/', authMiddleware, notificationController.listNotifications);
router.get('/unread-count', authMiddleware, notificationController.getUnreadCount);
router.patch('/:id/read', authMiddleware, notificationController.markAsRead);

module.exports = router;
