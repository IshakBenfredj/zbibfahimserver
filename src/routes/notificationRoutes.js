const express = require('express');
const router = express.Router();
const {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadCount,
  saveFcmToken
} = require('../controllers/notificationController');
const { protect } = require('../middlewares/auth');

router.use(protect);

router.get('/', getMyNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', markAllNotificationsAsRead);
router.put('/fcm-token', saveFcmToken);
router.put('/:id/read', markNotificationAsRead);

module.exports = router;
